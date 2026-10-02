import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configuration,envelope,decryptBuffer,encryptFile,collectObjects,assertSnapshotReferences,sendParts,safeBackupFailure} from './backup.mjs';
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
