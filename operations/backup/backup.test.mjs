import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {mkdtemp,writeFile,readFile,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configuration,envelope,decryptBuffer,encryptFile,collectObjects,assertSnapshotReferences,sendParts,safeBackupFailure} from './backup.mjs';
import * as backupModule from './backup.mjs';
import {verifyRestore} from './verify-restore.mjs';
const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const config={DATABASE_URL:'postgresql://backup:synthetic-secret@db.example.org:5432/postgres',EXPECTED_DB_HOST:'db.example.org',EXPECTED_DB_NAME:'postgres',OBJECT_STORAGE_ENDPOINT:'https://storage.example.org',OBJECT_STORAGE_REGION:'test',OBJECT_STORAGE_ACCESS_KEY:'synthetic',OBJECT_STORAGE_SECRET_KEY:'synthetic',OBJECT_STORAGE_BUCKET:'test',SMTP_HOST:'smtp.example.org',SMTP_USER:'test',SMTP_PASSWORD:'synthetic',SMTP_FROM_EMAIL:'test@example.org',SMTP_FROM_NAME:'test',SMTP_PORT:'465',SMTP_SECURE:'true'};
test('missing settings fail before database/storage/mail work without printing secrets',()=>{
  for(const name of Object.keys(config)) {const candidate={...config};delete candidate[name];assert.throws(()=>configuration(JSON.stringify(candidate)),e=>!e.message.includes('synthetic-secret')&&!e.message.includes('postgresql://'));}
});
test('explicit database identity, session pooler, HTTPS and TLS settings are mandatory',()=>{
  for(const change of [{EXPECTED_DB_HOST:'wrong'},{EXPECTED_DB_NAME:'wrong'},{DATABASE_URL:config.DATABASE_URL.replace(':5432',':6543')},{OBJECT_STORAGE_ENDPOINT:'http://storage.example.org'},{SMTP_PORT:'0'},{SMTP_SECURE:'yes'}]) assert.throws(()=>configuration(JSON.stringify({...config,...change})));
  assert.equal(configuration(JSON.stringify(config)).pg.PGOPTIONS.includes('read_only=on'),true);
});
test('encryption roundtrip, random envelopes, modification and wrong-key rejection',()=>{
  const plaintext=Buffer.from('synthetic database and private files');
  function encrypted(){const {prefix,cipher}=envelope(keys.publicKey);return Buffer.concat([prefix,cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);}
  const a=encrypted(),b=encrypted();assert.notDeepEqual(a,b);assert.deepEqual(decryptBuffer(a,keys.privateKey),plaintext);
  a[a.length-20]^=1;assert.throws(()=>decryptBuffer(a,keys.privateKey));
  assert.throws(()=>decryptBuffer(b,generateKeyPairSync('rsa',{modulusLength:3072}).privateKey));
  assert.throws(()=>envelope(generateKeyPairSync('rsa',{modulusLength:1024}).publicKey));
});
test('stream encryption never overwrites an existing file and decrypts exact bytes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));try{const source=join(dir,'source'),target=join(dir,'target');await writeFile(source,'synthetic');await encryptFile(source,target,keys.publicKey);assert.equal(decryptBuffer(await readFile(target),keys.privateKey).toString(),'synthetic');await assert.rejects(encryptFile(source,target,keys.publicKey));}finally{await rm(dir,{recursive:true,force:true});}
});
test('backup SMTP requires accepted owner recipient and contains encrypted bytes only',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));try{const path=join(dir,'encrypted');await writeFile(path,Buffer.from('encrypted fixture'));let delivered;
  const transport={sendMail:async message=>{delivered=message;return{accepted:['marwanalsawi@alzaad.org.sa']};}};
  assert.equal((await sendParts(transport,path,{address:'test@example.org'},'test')).parts,1);assert.equal(delivered.to,'marwanalsawi@alzaad.org.sa');assert.deepEqual(delivered.attachments[0].content,Buffer.from('encrypted fixture'));
  await assert.rejects(sendParts({sendMail:async()=>({accepted:[]})},path,{},'test'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('storage rejects incomplete pagination before downloading any object',async()=>{
  class List{};class Get{};let calls=0;const client={send:async()=>{calls++;return{IsTruncated:true,Contents:[]};}};
  await assert.rejects(collectObjects(client,{ListObjectsV2Command:List,GetObjectCommand:Get},'test',tmpdir()));assert.equal(calls,1);
});

class ListCommand { constructor(input) { this.input=input; } }
class GetCommand { constructor(input) { this.input=input; } }
class PutCommand { constructor(input) { this.input=input; } }
const storageCommands={ListObjectsV2Command:ListCommand,GetObjectCommand:GetCommand,PutObjectCommand:PutCommand};

test('encrypted storage upload and exact readback precede owner notification without attachments or URLs',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));
  try {
    const path=join(dir,'encrypted'),payload=Buffer.from('already encrypted synthetic fixture'),events=[];
    await writeFile(path,payload);
    const client={send:async command=>{
      assert.equal(command.input.Bucket,'test');assert.equal(command.input.Key,'alzad-encrypted-backups/test-unique.enc');
      if(command instanceof PutCommand) {
        events.push('upload');assert.equal(command.input.IfNoneMatch,'*');assert.equal(command.input.ACL,undefined);
        assert.equal(command.input.ContentLength,payload.length);assert.equal(command.input.Body instanceof Buffer,false);
        const chunks=[];for await(const chunk of command.input.Body)chunks.push(chunk);
        assert.deepEqual(Buffer.concat(chunks),payload);return {};
      }
      assert.equal(command instanceof GetCommand,true);events.push('readback');return{Body:Readable.from([payload.subarray(0,5),payload.subarray(5)]),ContentLength:payload.length};
    }};
    const transport={sendMail:async message=>{events.push('notification');assert.equal(message.to,'marwanalsawi@alzaad.org.sa');assert.equal(message.attachments,undefined);assert.doesNotMatch(JSON.stringify(message),/https?:\/\//);return{accepted:['marwanalsawi@alzaad.org.sa']};}};
    const result=await backupModule.deliverStoredBackup(client,storageCommands,'test',path,transport,{address:'test@example.org'},'test-unique');
    assert.deepEqual(events,['upload','readback','notification']);assert.equal(result.bytes,payload.length);
    assert.equal(result.sha256,createHash('sha256').update(payload).digest('hex'));assert.equal(result.storageVerified,true);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('upload, readback and exact byte/hash failures prevent every success notification',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));
  try {
    const path=join(dir,'encrypted'),payload=Buffer.from('encrypted fixture');await writeFile(path,payload);
    for(const failure of ['upload','readback','hash','truncated','extra','metadata','missing-body','body-error']) {
      let notifications=0;
      const client={send:async command=>{
        if(command instanceof PutCommand){if(failure==='upload')throw new Error('synthetic failure');for await(const chunk of command.input.Body){}return{};}
        if(failure==='readback')throw new Error('synthetic failure');
        if(failure==='missing-body')return{};
        if(failure==='body-error')return{Body:Readable.from((async function*(){yield payload.subarray(0,1);throw new Error('synthetic failure');})())};
        const body=failure==='hash'?Buffer.alloc(payload.length,42):failure==='truncated'?payload.subarray(1):failure==='extra'?Buffer.concat([payload,Buffer.from('!')]):payload;
        return{Body:Readable.from([body]),ContentLength:failure==='metadata'?payload.length+1:body.length};
      }};
      await assert.rejects(backupModule.deliverStoredBackup(client,storageCommands,'test',path,{sendMail:async()=>{notifications++;return{accepted:['marwanalsawi@alzaad.org.sa']};}}, {},'failure-test'));
      assert.equal(notifications,0,failure);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('stored backup requires the exact owner SMTP acceptance and never overwrites on a key collision',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));
  try {
    const path=join(dir,'encrypted'),payload=Buffer.from('encrypted fixture');await writeFile(path,payload);
    const client={send:async command=>{if(command instanceof PutCommand){for await(const chunk of command.input.Body){}return{};}return{Body:Readable.from([payload]),ContentLength:payload.length};}};
    for(const accepted of [[],['other@example.org'],['marwanalsawi@alzaad.org.sa.attacker.invalid']]) await assert.rejects(backupModule.deliverStoredBackup(client,storageCommands,'test',path,{sendMail:async message=>{assert.equal(message.to,'marwanalsawi@alzaad.org.sa');return{accepted};}}, {},'recipient-test'));
    let readbacks=0,notifications=0;
    await assert.rejects(backupModule.deliverStoredBackup({send:async command=>{if(command instanceof PutCommand){assert.equal(command.input.IfNoneMatch,'*');throw new Error('already exists');}readbacks++;}},storageCommands,'test',path,{sendMail:async()=>{notifications++;}}, {},'collision-test'));
    assert.equal(readbacks,0);assert.equal(notifications,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});

for(const bytes of [8*1024*1024,8*1024*1024+1,133770175]) test(`stored delivery streams ${bytes} bytes in verified objects no larger than 8 MiB`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));
  try {
    const path=join(dir,'large-encrypted'),file=await open(path,'w');try{await file.truncate(bytes);}finally{await file.close();}
    const stored=new Map(),receivedHash=createHash('sha256');let puts=0,gets=0,notifications=0,totalUploaded=0;
    const client={send:async command=>{
      assert.equal(command.input.Bucket,'test');
      if(command instanceof PutCommand){
        puts++;assert.equal(command.input.IfNoneMatch,'*');assert.equal(command.input.ACL,undefined);
        assert.ok(command.input.ContentLength<=8*1024*1024);assert.ok(command.input.ContentLength>0);
        assert.equal(Buffer.isBuffer(command.input.Body),false);assert.equal(command.input.Body.start,(puts-1)*8*1024*1024);
        assert.equal(command.input.Key,`alzad-encrypted-backups/large-test.enc${bytes>8*1024*1024?`.part-${String(puts).padStart(4,'0')}`:''}`);
        let uploaded=0;for await(const chunk of command.input.Body){assert.ok(chunk.length<=65536);uploaded+=chunk.length;receivedHash.update(chunk);}
        assert.equal(uploaded,command.input.ContentLength);totalUploaded+=uploaded;stored.set(command.input.Key,{start:command.input.Body.start,end:command.input.Body.end,bytes:uploaded});return{};
      }
      assert.equal(command instanceof GetCommand,true);gets++;const part=stored.get(command.input.Key);assert.ok(part);
      return{Body:createReadStream(path,{start:part.start,end:part.end}),ContentLength:part.bytes};
    }};
    const result=await backupModule.deliverStoredBackup(client,storageCommands,'test',path,{sendMail:async message=>{
      notifications++;assert.equal(gets,Math.ceil(bytes/(8*1024*1024)));assert.equal(message.attachments,undefined);assert.doesNotMatch(JSON.stringify(message),/https?:\/\//);
      assert.ok(message.text.includes(String(bytes)));assert.ok(message.text.includes(String(gets)));return{accepted:['marwanalsawi@alzaad.org.sa']};
    }}, {},'large-test');
    assert.equal(result.bytes,bytes);assert.equal(result.parts,Math.ceil(bytes/(8*1024*1024)));assert.equal(result.sha256,receivedHash.digest('hex'));
    assert.equal(puts,result.parts);assert.equal(gets,result.parts);assert.equal(totalUploaded,bytes);assert.equal(notifications,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('stored encrypted parts reconstruct exactly and authenticate only in correct order without tampering',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));
  try {
    const source=join(dir,'source'),encrypted=join(dir,'encrypted'),plaintext=Buffer.alloc(8*1024*1024+123,42),stored=new Map();
    await writeFile(source,plaintext);await encryptFile(source,encrypted,keys.publicKey);
    const client={send:async command=>{
      if(command instanceof PutCommand){assert.ok(command.input.ContentLength<=8*1024*1024);const chunks=[];for await(const chunk of command.input.Body)chunks.push(chunk);stored.set(command.input.Key,Buffer.concat(chunks));return{};}
      assert.equal(command instanceof GetCommand,true);const part=stored.get(command.input.Key);return{Body:Readable.from([part]),ContentLength:part.length};
    }};
    const result=await backupModule.deliverStoredBackup(client,storageCommands,'test',encrypted,{sendMail:async()=>({accepted:['marwanalsawi@alzaad.org.sa']})}, {},'encrypted-roundtrip');
    const ordered=[...stored.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,part])=>part),joined=Buffer.concat(ordered);
    assert.equal(result.parts,2);assert.deepEqual(joined,await readFile(encrypted));assert.equal(result.sha256,createHash('sha256').update(joined).digest('hex'));
    assert.deepEqual(decryptBuffer(joined,keys.privateKey),plaintext);
    assert.throws(()=>decryptBuffer(Buffer.concat([...ordered].reverse()),keys.privateKey));assert.throws(()=>decryptBuffer(ordered[0],keys.privateKey));
    joined[joined.length-20]^=1;assert.throws(()=>decryptBuffer(joined,keys.privateKey));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('second-part upload/collision/readback failures leave existing private parts and send no success email',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));
  try {
    const path=join(dir,'encrypted'),bytes=8*1024*1024+123,file=await open(path,'w');try{await file.truncate(bytes);}finally{await file.close();}
    for(const failure of ['upload','collision','missing','truncated','tampered']) {
      let puts=0,gets=0,notifications=0;const stored=new Map();
      const client={send:async command=>{
        if(command instanceof PutCommand){
          puts++;assert.ok(command.input.ContentLength<=8*1024*1024);assert.equal(command.input.IfNoneMatch,'*');assert.equal(command.input.ACL,undefined);
          if(puts===2&&['upload','collision'].includes(failure))throw new Error('synthetic second-part failure');
          for await(const chunk of command.input.Body){}stored.set(command.input.Key,{start:command.input.Body.start,end:command.input.Body.end,bytes:command.input.ContentLength});return{};
        }
        assert.equal(command instanceof GetCommand,true,'no delete or other storage command is allowed');gets++;const part=stored.get(command.input.Key);assert.ok(part);
        if(gets===2&&failure==='missing')return{};
        if(gets===2&&failure==='tampered')return{Body:Readable.from([Buffer.alloc(part.bytes,42)]),ContentLength:part.bytes};
        return{Body:createReadStream(path,{start:part.start,end:part.end-(gets===2&&failure==='truncated'?1:0)}),ContentLength:part.bytes};
      }};
      await assert.rejects(backupModule.deliverStoredBackup(client,storageCommands,'test',path,{sendMail:async()=>{notifications++;return{accepted:['marwanalsawi@alzaad.org.sa']};}}, {},`second-${failure}`));
      assert.equal(puts,2,failure);assert.equal(notifications,0,failure);assert.equal(stored.size,['upload','collision'].includes(failure)?1:2,failure);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('notification failure leaves the verified stored archive intact without any deletion command',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));
  try {
    const path=join(dir,'encrypted'),payload=Buffer.from('encrypted fixture'),calls=[];await writeFile(path,payload);
    const client={send:async command=>{calls.push(command.constructor);if(command instanceof PutCommand){for await(const chunk of command.input.Body){}return{};}assert.equal(command instanceof GetCommand,true);return{Body:Readable.from([payload]),ContentLength:payload.length};}};
    await assert.rejects(backupModule.deliverStoredBackup(client,storageCommands,'test',path,{sendMail:async()=>{throw new Error('SMTP unavailable');}}, {},'notification-failure'),/SMTP unavailable/);
    assert.deepEqual(calls,[PutCommand,GetCommand]);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('only the fixed backup prefix is excluded consistently from both storage listings',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));
  try {
    const objects=[{Key:'private/document',ETag:'one',Size:1},{Key:'alzad-encrypted-backups-other/file',ETag:'two',Size:1}],downloaded=[];let listings=0;
    const client={send:async command=>{if(command instanceof ListCommand){listings++;return{Contents:[...objects,{Key:`alzad-encrypted-backups/${listings}.enc`,ETag:String(listings),Size:2*1024**3}]};}downloaded.push(command.input.Key);return{Body:Readable.from([Buffer.from('x')])};}};
    const manifest=await collectObjects(client,storageCommands,'test',dir,10);
    assert.deepEqual(downloaded,objects.map(object=>object.Key).sort());assert.equal(manifest.length,2);assert.equal(listings,2);
    assert.throws(()=>assertSnapshotReferences([{bucket:'test',key:'alzad-encrypted-backups/misused-app-file'}],manifest,'test'));
    assert.throws(()=>assertSnapshotReferences([{bucket:'test',key:'private/missing-app-file'}],manifest,'test'));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('non-backup object changes between listings still fail the snapshot',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));
  try {
    let listings=0;const client={send:async command=>{if(command instanceof ListCommand)return{Contents:[{Key:'private/document',ETag:String(++listings),Size:1}]};return{Body:Readable.from([Buffer.from('x')])};}};
    await assert.rejects(collectObjects(client,storageCommands,'test',dir),/Storage changed during backup/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('backup rejects a database snapshot whose referenced private file vanished or changed before S3 capture',()=>{
  const object={key:'private/test.jpg',sha256:'abc'};
  assert.equal(assertSnapshotReferences([{bucket:'test',key:object.key,sha256:'abc'}],[object],'test'),1);
  assert.throws(()=>assertSnapshotReferences([{bucket:'test',key:object.key,sha256:'abc'}],[],'test'));
  assert.throws(()=>assertSnapshotReferences([{bucket:'test',key:object.key,sha256:'abc'}],[{...object,sha256:'def'}],'test'));
  assert.throws(()=>assertSnapshotReferences([{bucket:'production',key:object.key}],[object],'test'));
});

test('multipart delivery preserves every byte and refuses oversized backups before any email',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-'));
  try {
    const path=join(dir,'parts'),payload=Buffer.alloc(8*1024*1024+123,42),received=[];
    await writeFile(path,payload);
    const result=await sendParts({sendMail:async message=>{received.push(message.attachments[0].content);return {accepted:['marwanalsawi@alzaad.org.sa']};}},path,{},'multipart-test');
    assert.equal(result.parts,2);assert.equal(result.capacityWarning,false);assert.deepEqual(Buffer.concat(received),payload);
    const warningFile=await open(path,'w');try {await warningFile.truncate(48*1024*1024);} finally {await warningFile.close();}
    let warnings=0;
    const nearLimit=await sendParts({sendMail:async message=>{if(message.text.includes('تنبيه سعة')) warnings++;return {accepted:['marwanalsawi@alzaad.org.sa']};}},path,{},'near-limit-test');
    assert.equal(nearLimit.capacityWarning,true);assert.equal(warnings,nearLimit.parts);
    const file=await open(path,'w');try {await file.truncate(64*1024*1024+1);} finally {await file.close();}
    let attempts=0;await assert.rejects(sendParts({sendMail:async()=>{attempts++;}},path,{},'oversized-test'),error=>error.code==='BACKUP_EMAIL_SIZE_LIMIT'&&error.bytes===64*1024*1024+1&&error.limitBytes===64*1024*1024);assert.equal(attempts,0);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('backup diagnostics whitelist only safe error metadata and never reveal arbitrary error text',()=>{
  const secret='synthetic-secret@example.org postgres://user:password@private-host/object-key';
  for(const code of ['EAUTH','ETIMEDOUT','ESOCKET','BACKUP_EMAIL_SIZE_LIMIT']) {
    const result=safeBackupFailure({code,responseCode:535,command:'AUTH PLAIN',bytes:123,limitBytes:456,message:secret,stack:secret,response:secret});
    assert.equal(result.code,code);assert.equal(result.responseCode,535);assert.equal(result.command,'AUTH PLAIN');assert.equal(JSON.stringify(result).includes(secret),false);
  }
  assert.deepEqual(safeBackupFailure({code:secret,command:secret,responseCode:secret,bytes:-1,limitBytes:Infinity,message:secret}),{status:'BACKUP_FAILED',code:'UNKNOWN'});
  assert.deepEqual(safeBackupFailure(null),{status:'BACKUP_FAILED',code:'UNKNOWN'});
});

test('AWS diagnostics allowlist service error names and bounded HTTP/retry metadata without identifiers',()=>{
  const secret='synthetic-secret@example.org https://private-storage.invalid/private-object?signature=secret';
  for(const name of ['AccessDenied','SignatureDoesNotMatch','NotImplemented','InvalidRequest','PreconditionFailed','SlowDown','NoSuchKey']) {
    const result=safeBackupFailure({name,message:secret,stack:secret,requestId:secret,$metadata:{httpStatusCode:403,attempts:3,totalRetryDelay:250,requestId:secret,extendedRequestId:secret,cfId:secret},$response:{body:secret,headers:{location:secret}}});
    assert.deepEqual(result,{status:'BACKUP_FAILED',code:name,httpStatusCode:403,attempts:3,totalRetryDelay:250});
    assert.equal(JSON.stringify(result).includes(secret),false);
  }
  assert.deepEqual(safeBackupFailure({code:'ETIMEDOUT',name:'AccessDenied',$metadata:{httpStatusCode:503,attempts:1,totalRetryDelay:0}}),{status:'BACKUP_FAILED',code:'ETIMEDOUT',httpStatusCode:503,attempts:1,totalRetryDelay:0});
  for(const metadata of [{httpStatusCode:99,attempts:0,totalRetryDelay:-1},{httpStatusCode:600,attempts:11,totalRetryDelay:600001},{httpStatusCode:'403',attempts:'3',totalRetryDelay:'250'},{httpStatusCode:Infinity,attempts:NaN,totalRetryDelay:Infinity}]) assert.deepEqual(safeBackupFailure({name:secret,$metadata:metadata}),{status:'BACKUP_FAILED',code:'UNKNOWN'});
});

test('stored delivery logs only fixed upload, readback and notification stage markers',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'alzad-backup-test-')),originalLog=console.log,logs=[];
  try {
    console.log=(...values)=>logs.push(values);
    const path=join(dir,'encrypted'),payload=Buffer.from('encrypted fixture');await writeFile(path,payload);
    const client={send:async command=>{if(command instanceof PutCommand){for await(const chunk of command.input.Body){}return{};}return{Body:Readable.from([payload]),ContentLength:payload.length};}};
    await backupModule.deliverStoredBackup(client,storageCommands,'private-bucket',path,{sendMail:async()=>({accepted:['marwanalsawi@alzaad.org.sa']})},{address:'private-sender@example.org'},'private-id');
    assert.deepEqual(logs,[['BACKUP_STAGE: ENCRYPTED_BACKUP_UPLOAD'],['BACKUP_STAGE: ENCRYPTED_BACKUP_READBACK'],['BACKUP_STAGE: BACKUP_EMAIL_NOTIFICATION']]);
    logs.length=0;
    await assert.rejects(backupModule.deliverStoredBackup({send:async()=>{throw new Error('private error');}},storageCommands,'private-bucket',path,{}, {},'private-id'));
    assert.deepEqual(logs,[['BACKUP_STAGE: ENCRYPTED_BACKUP_UPLOAD']]);
  } finally {console.log=originalLog;await rm(dir,{recursive:true,force:true});}
});

test('restore verification is networkless, never receives Production settings, and cleans only its own container',async()=>{
  const calls=[];
  const execute=async(command,args,options)=>{calls.push({command,args,options});return args.includes('-At')?(String(args.at(-1)).includes('to_regclass')?'f':'[{"table_name":"_prisma_migrations","row_count":"1"}]'):'';};
  const result=await verifyRestore(join(tmpdir(),'synthetic.dump'),execute);
  assert.equal(result.status,'RESTORE_PASS');
  assert.deepEqual(calls[0].args.slice(0,5),['run','--detach','--rm','--network','none']);
  assert.equal(calls[0].args.some(arg=>arg.endsWith('target=/backup.dump,readonly')),true);
  assert.equal(calls[0].options.env.ALZAD_BACKUP_CONFIG,undefined);
  assert.equal(calls[0].options.env.BACKUP_PUBLIC_KEY,undefined);
  assert.equal(calls.some(call=>call.args.includes('pg_isready')),false);
  assert.equal(calls.some(call=>call.args.includes('127.0.0.1')&&call.args.includes('alzad_backup_restore_test')&&call.args.at(-1)==='SELECT 1'),true);
  const container=calls[0].args[calls[0].args.indexOf('--name')+1];
  assert.deepEqual(calls.at(-1).args,['rm','--force','--volumes',container]);
});

test('failed restore still removes only its own disposable verification container',async()=>{
  const calls=[];await assert.rejects(verifyRestore(join(tmpdir(),'synthetic.dump'),async(command,args)=>{calls.push(args);if(args.includes('pg_restore'))throw new Error('synthetic failure');return '';}));
  assert.equal(calls.at(-1)[0],'rm');assert.match(calls.at(-1).at(-1),/^alzad-backup-restore-[a-f0-9]{16}$/);
});
