import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { capture, verifyRestore, POSTGRES_IMAGE } from './verify-restore.mjs';

test('real PostgreSQL dump restores exact synthetic row counts in a separate networkless database', {timeout:180000}, async()=>{
  assert.equal(process.env.ALZAD_BACKUP_CONFIG,undefined,'Integration fixture must never receive Production credentials');
  const directory=await mkdtemp(join(tmpdir(),'alzad-backup-integration-'));
  const name='alzad-backup-fixture-'+randomBytes(8).toString('hex');let created=false;
  try {
    await capture('docker',['run','--detach','--rm','--network','none','--name',name,'--env','POSTGRES_HOST_AUTH_METHOD=trust',POSTGRES_IMAGE]);created=true;
    let ready=false;for(let attempt=0;attempt<30;attempt++){try{await capture('docker',['exec',name,'pg_isready','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,1000));}}
    assert.equal(ready,true);
    await capture('docker',['exec',name,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-c',"CREATE TABLE public._prisma_migrations(id text PRIMARY KEY); INSERT INTO public._prisma_migrations VALUES ('synthetic-migration'); CREATE TABLE public.synthetic_backup_records(id integer PRIMARY KEY,label text NOT NULL); INSERT INTO public.synthetic_backup_records VALUES (1,'synthetic-one'),(2,'synthetic-two');"]);
    await capture('docker',['exec',name,'pg_dump','-U','postgres','--format=custom','--schema=public','--no-owner','--no-acl','--file=/tmp/synthetic.dump','postgres']);
    const dump=join(directory,'synthetic.dump');await capture('docker',['cp',`${name}:/tmp/synthetic.dump`,dump]);
    const result=await verifyRestore(dump);
    assert.equal(result.status,'RESTORE_PASS');
    assert.deepEqual(result.tableCounts,[{table_name:'_prisma_migrations',row_count:'1'},{table_name:'synthetic_backup_records',row_count:'2'}]);
  } finally {
    if(created)await capture('docker',['rm','--force','--volumes',name]);
    await rm(directory,{recursive:true,force:true});
  }
});
