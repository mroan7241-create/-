import { createCipheriv, createDecipheriv, createHash, createPublicKey, constants, publicEncrypt, privateDecrypt, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { verifyRestore } from './verify-restore.mjs';

const MAGIC = Buffer.from('ALZADBK1');
const RECIPIENT = 'marwanalsawi@alzaad.org.sa';
const PART_SIZE = 8 * 1024 * 1024;
const MAX_EMAIL_BYTES = 64 * 1024 * 1024;
const CAPACITY_WARNING_BYTES = 48 * 1024 * 1024;
const require = createRequire(new URL('../../platform/apps/api/package.json', import.meta.url));
const missing = name => { throw new Error(`Missing or invalid backup setting: ${name}`); };
export function configuration(raw) {
  let c; try { c = JSON.parse(raw); } catch { missing('ALZAD_BACKUP_CONFIG'); }
  for (const name of ['DATABASE_URL', 'EXPECTED_DB_HOST', 'EXPECTED_DB_NAME', 'OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_REGION', 'OBJECT_STORAGE_ACCESS_KEY', 'OBJECT_STORAGE_SECRET_KEY', 'OBJECT_STORAGE_BUCKET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL', 'SMTP_FROM_NAME']) if (typeof c[name] !== 'string' || !c[name].trim()) missing(name);
  let db; try { db = new URL(c.DATABASE_URL); } catch { missing('DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.hostname !== c.EXPECTED_DB_HOST || decodeURIComponent(db.pathname.slice(1)) !== c.EXPECTED_DB_NAME || !db.username || !db.password || db.port === '6543') missing('DATABASE_URL');
  if (!/^[A-Za-z0-9_-]+$/.test(c.EXPECTED_DB_NAME)) missing('EXPECTED_DB_NAME');
  let endpoint; try { endpoint = new URL(c.OBJECT_STORAGE_ENDPOINT); } catch { missing('OBJECT_STORAGE_ENDPOINT'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) missing('OBJECT_STORAGE_ENDPOINT');
  if (!/^\d+$/.test(String(c.SMTP_PORT)) || Number(c.SMTP_PORT) < 1 || Number(c.SMTP_PORT) > 65535) missing('SMTP_PORT');
  if (!['true','false'].includes(String(c.SMTP_SECURE))) missing('SMTP_SECURE');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.SMTP_FROM_EMAIL)) missing('SMTP_FROM_EMAIL');
  c.pg = { PGHOST: db.hostname, PGPORT: db.port || '5432', PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password), PGDATABASE: c.EXPECTED_DB_NAME, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '15', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=300000' };
  return c;
}
export function envelope(publicKey) {
  const parsed = createPublicKey(publicKey);
  if (parsed.asymmetricKeyType !== 'rsa' || parsed.asymmetricKeyDetails.modulusLength < 3072) missing('BACKUP_PUBLIC_KEY');
  const key = randomBytes(32), iv = randomBytes(12);
  const wrapped = publicEncrypt({ key: parsed, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  const header = Buffer.from(JSON.stringify({ algorithm: 'AES-256-GCM+RSA-OAEP-SHA256', iv: iv.toString('base64'), wrapped: wrapped.toString('base64') }));
  const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
  const prefix = Buffer.concat([MAGIC, length, header]);
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(prefix);
  return { prefix, cipher };
}
export function decryptBuffer(bytes, privateKey) {
  if (!bytes.subarray(0,8).equals(MAGIC) || bytes.length < 28) throw new Error('Invalid backup envelope');
  const length = bytes.readUInt32BE(8), offset = 12 + length;
  if (length > 4096 || offset + 16 > bytes.length) throw new Error('Invalid backup envelope');
  const header = JSON.parse(bytes.subarray(12,offset).toString('utf8'));
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(header.wrapped,'base64'));
  const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(header.iv,'base64'));
  decipher.setAAD(bytes.subarray(0,offset)); decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(offset,-16)),decipher.final()]);
}
export async function encryptFile(source, target, publicKey) {
  const { prefix, cipher } = envelope(publicKey);
  await writeFile(target,prefix,{ flag: 'wx', mode: 0o600 });
  await pipeline(createReadStream(source),cipher,createWriteStream(target,{flags:'a',mode:0o600}));
  await writeFile(target,cipher.getAuthTag(),{flag:'a',mode:0o600});
}
export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export function run(command,args,options={}) {
  return new Promise((accept,reject)=>{
    const child=spawn(command,args,{...options,stdio:['ignore','ignore','pipe'],shell:false,windowsHide:true});
    // Tool stderr can contain credentials/object keys: never emit or include it in errors.
    child.stderr.resume();
    const timeout=setTimeout(()=>child.kill('SIGKILL'),10*60*1000);
    child.on('error',()=>{clearTimeout(timeout);reject(new Error('Backup command could not start'));});
    child.on('close',code=>{clearTimeout(timeout);code===0?accept():reject(new Error('Backup command failed or timed out'));});
  });
}
export async function collectObjects(client,commands,bucket,directory,maxBytes=2*1024**3) {
  const { ListObjectsV2Command, GetObjectCommand }=commands;
  async function listing() {
    const items=[]; let token;
    do { const page=await client.send(new ListObjectsV2Command({Bucket:bucket,ContinuationToken:token})); items.push(...(page.Contents||[])); if(page.IsTruncated&&!page.NextContinuationToken) throw new Error('Incomplete storage listing'); token=page.IsTruncated?page.NextContinuationToken:undefined; } while(token);
    return items.sort((a,b)=>a.Key.localeCompare(b.Key));
  }
  const before=await listing(); let total=0; const manifest=[];
  for(const item of before) {
    if(!item.Key||!item.ETag) throw new Error('Incomplete object metadata');
    total+=item.Size||0; if(total>maxBytes) throw new Error('Backup exceeds configured size limit');
    // Numeric local filenames prevent untrusted object keys from escaping the directory.
    const filename=`object-${String(manifest.length+1).padStart(8,'0')}`;
    const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:item.Key,IfMatch:item.ETag}));
    if(!response.Body) throw new Error('Missing object body');
    const destination=join(directory,filename);
    await pipeline(response.Body,createWriteStream(destination,{flags:'wx',mode:0o600}));
    if((await stat(destination)).size!==item.Size) throw new Error('Object size mismatch');
    manifest.push({key:item.Key,filename,bytes:item.Size,sha256:await hashFile(destination),etag:item.ETag,versionId:response.VersionId,contentType:response.ContentType});
  }
  const after=await listing();
  if(JSON.stringify(before.map(i=>[i.Key,i.ETag,i.Size]))!==JSON.stringify(after.map(i=>[i.Key,i.ETag,i.Size]))) throw new Error('Storage changed during backup; retry without reporting success');
  return manifest;
}
export function assertSnapshotReferences(references, manifest, bucket) {
  const archived = new Map(manifest.map(item => [item.key, item]));
  for (const reference of references) {
    const object = archived.get(reference.key);
    if (reference.bucket !== bucket || !object ||
        (reference.sha256 && reference.sha256.toLowerCase() !== object.sha256.toLowerCase())) {
      throw new Error('Database snapshot references an unavailable or mismatched private object; backup must not be reported successful');
    }
  }
  return references.length;
}
export async function sendParts(transport,encryptedPath,from,id) {
  const size=(await stat(encryptedPath)).size,parts=Math.ceil(size/PART_SIZE),sha256=await hashFile(encryptedPath);
  if(size===0||size>MAX_EMAIL_BYTES) throw Object.assign(new Error('Backup exceeds safe email size limit; no parts sent'),{code:'BACKUP_EMAIL_SIZE_LIMIT',bytes:size,limitBytes:MAX_EMAIL_BYTES});
  const capacityWarning=size>=CAPACITY_WARNING_BYTES;
  let index=0;
  while(index<parts) {
    const chunks=[];
    for await(const chunk of createReadStream(encryptedPath,{start:index*PART_SIZE,end:Math.min(size,(index+1)*PART_SIZE)-1})) chunks.push(chunk);
    const content=Buffer.concat(chunks);
    if(content.length!==Math.min(PART_SIZE,size-index*PART_SIZE)) throw new Error('Incomplete backup part');
    index++;
    const filename=`alzad-${id}.enc.part-${String(index).padStart(4,'0')}`;
    const text=`نسخة احتياطية مشفّرة — الجزء ${index} من ${parts}.\nمعرّف النسخة: ${id}\nاحتفظ بجميع الأجزاء. يلزم مفتاح الاستعادة المنفصل لفكها.\nSHA256 للملف المشفّر الكامل: ${sha256}\nيشمل مخطط public وبياناته وملفات التخزين الخاص. لا يشمل أسرار التشغيل أو كلمات مرور أدوار PostgreSQL.${capacityWarning?'\nتنبيه سعة: اقترب حجم النسخة من حد البريد 64 MiB. يلزم اعتماد قناة تسليم/احتفاظ بديلة قبل تجاوز الحد.':''}`;
    const result=await transport.sendMail({from,to:RECIPIENT,subject:`النسخة الاحتياطية اليومية المشفّرة — ${id} — ${index}/${parts}`,text,html:`<div dir="rtl" style="text-align:right;font-family:Tahoma,Arial">${text.replaceAll('\n','<br>')}</div>`,attachments:[{filename,content,contentType:'application/octet-stream'}]});
    if(!result.accepted?.some(address=>String(address).toLowerCase()===RECIPIENT)) throw new Error('Backup recipient was not accepted by SMTP');
  }
  if(index!==parts) throw new Error('Incomplete backup part delivery');
  return {id,parts,bytes:size,sha256,capacityWarning};
}
// SMTP/provider error messages can contain credentials, addresses and object keys.
// Emit only explicitly allowlisted codes and bounded numerical metadata.
export function safeBackupFailure(error) {
  const source=error&&typeof error==='object'?error:{};
  const codes=['BACKUP_EMAIL_SIZE_LIMIT','EAUTH','ETIMEDOUT','ESOCKET','ECONNECTION','ECONNREFUSED','ECONNRESET','EDNS','EENVELOPE','EMESSAGE','ENOENT','EACCES','ENOSPC'];
  const result={status:'BACKUP_FAILED',code:codes.includes(source.code)?source.code:'UNKNOWN'};
  if(Number.isInteger(source.responseCode)&&source.responseCode>=100&&source.responseCode<=599) result.responseCode=source.responseCode;
  if(['CONN','EHLO','STARTTLS','AUTH','AUTH PLAIN','AUTH LOGIN','MAIL FROM','RCPT TO','DATA'].includes(source.command)) result.command=source.command;
  for(const field of ['bytes','limitBytes']) if(Number.isSafeInteger(source[field])&&source[field]>=0) result[field]=source[field];
  return result;
}
export async function backup() {
  const config=configuration(process.env.ALZAD_BACKUP_CONFIG);
  const publicKey=process.env.BACKUP_PUBLIC_KEY;
  envelope(publicKey); // Validate before reading any Production data.
  const directory=await mkdtemp(join(tmpdir(),'alzad-backup-'));
  const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(4).toString('hex');
  try {
    const snapshot=join(directory,'snapshot'); await mkdir(snapshot,{mode:0o700});
    const objects=join(snapshot,'objects'); await mkdir(objects,{mode:0o700});
    const dump=join(snapshot,'database.dump');
    console.log('BACKUP_STAGE: READ_ONLY_DATABASE_EXPORT');
    await run(process.env.PG_DUMP_PATH||'pg_dump',['--no-password','--format=custom','--schema=public','--no-owner','--no-acl','--lock-wait-timeout=15000','--file',dump],{env:{...process.env,...config.pg}});
    if((await stat(dump)).size===0) throw new Error('Empty database dump');
    await run(process.env.PG_RESTORE_PATH||'pg_restore',['--list',dump]);
    console.log('BACKUP_STAGE: ISOLATED_RESTORE');
    const restoreVerification=await verifyRestore(dump);
    console.log('BACKUP_STAGE: PRIVATE_OBJECTS');
    const s3=require('@aws-sdk/client-s3');
    const client=new s3.S3Client({endpoint:config.OBJECT_STORAGE_ENDPOINT,region:config.OBJECT_STORAGE_REGION,forcePathStyle:String(config.OBJECT_STORAGE_FORCE_PATH_STYLE||'true')==='true',credentials:{accessKeyId:config.OBJECT_STORAGE_ACCESS_KEY,secretAccessKey:config.OBJECT_STORAGE_SECRET_KEY},maxAttempts:3});
    let manifest;
    try { manifest=await collectObjects(client,s3,config.OBJECT_STORAGE_BUCKET,objects); } finally { client.destroy(); }
    const { referencedObjects, ...restoreSummary } = restoreVerification;
    const verifiedFileReferences = assertSnapshotReferences(referencedObjects,manifest,config.OBJECT_STORAGE_BUCKET);
    await writeFile(join(snapshot,'manifest.json'),JSON.stringify({format:1,id,createdAt:new Date().toISOString(),database:{file:'database.dump',sha256:await hashFile(dump),schema:'public'},restoreVerification:{...restoreSummary,verifiedFileReferences},objects:manifest,limitations:['Database-referenced objects verified against the dump, but no global atomic snapshot across database and object storage','Server roles, passwords and deployment secrets are not included']},null,2),{flag:'wx',mode:0o600});
    const archive=join(directory,'snapshot.tar.gz'),encrypted=join(directory,'backup.enc');
    console.log('BACKUP_STAGE: ENCRYPTION');
    await run('tar',['-czf',archive,'-C',snapshot,'.']);
    await encryptFile(archive,encrypted,publicKey);
    const nodemailer=require('nodemailer');
    const secure=String(config.SMTP_SECURE)==='true';
    const transport=nodemailer.createTransport({host:config.SMTP_HOST,port:Number(config.SMTP_PORT),secure,requireTLS:!secure,auth:{user:config.SMTP_USER,pass:config.SMTP_PASSWORD},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:60000,logger:false,debug:false});
    console.log('BACKUP_STAGE: ENCRYPTED_EMAIL_DELIVERY');
    const encryptedBytes=(await stat(encrypted)).size;
    console.log(JSON.stringify({status:'ENCRYPTED_ARCHIVE_SIZE',bytes:encryptedBytes,parts:Math.ceil(encryptedBytes/PART_SIZE),limitBytes:MAX_EMAIL_BYTES}));
    try { const result=await sendParts(transport,encrypted,{name:config.SMTP_FROM_NAME,address:config.SMTP_FROM_EMAIL},id); console.log(JSON.stringify({status:'SMTP_ACCEPTED',...result,objects:manifest.length})); } finally { transport.close(); }
  } finally {
    // Only this invocation's freshly created, known child directory is removed.
    if(directory.startsWith(join(tmpdir(),'alzad-backup-'))) await rm(directory,{recursive:true,force:true});
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  backup().catch(error=>{console.error(JSON.stringify(safeBackupFailure(error)));process.exitCode=1;});
}
