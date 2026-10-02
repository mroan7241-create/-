import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
export const POSTGRES_IMAGE = 'postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722';

export function capture(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const { timeoutMs = 5 * 60 * 1000, syntheticDiagnostics = false, ...spawnOptions } = options;
    if (syntheticDiagnostics && (process.env.ALZAD_BACKUP_CONFIG || spawnOptions.env?.ALZAD_BACKUP_CONFIG)) {
      reject(new Error('Synthetic diagnostics are forbidden with Production settings')); return;
    }
    const child = spawn(command, args, { ...spawnOptions, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', overflow = false, diagnostic = '';
    if (syntheticDiagnostics) child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes.toString()).slice(-4000); });
    else child.stderr.resume();
    child.stdout.on('data', bytes => {
      output += bytes.toString();
      if (output.length > 2 * 1024 * 1024) { overflow = true; child.kill('SIGKILL'); }
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Isolated restore command could not start')); });
    child.on('close', code => {
      clearTimeout(timer);
      code === 0 && !overflow ? accept(output.trim()) : reject(new Error(syntheticDiagnostics ? `Synthetic ${command} failed: ${diagnostic}` : 'Isolated restore command failed or timed out'));
    });
  });
}

export async function verifyRestore(dump, execute = capture) {
  const name = `alzad-backup-restore-${randomBytes(8).toString('hex')}`;
  const env = { ...process.env };
  delete env.ALZAD_BACKUP_CONFIG;
  delete env.BACKUP_PUBLIC_KEY;
  const docker = (args, timeoutMs) => execute('docker', args, { env, timeoutMs });
  let created = false;
  try {
    await docker(['run', '--detach', '--rm', '--network', 'none', '--memory', '512m', '--cpus', '1', '--name', name,
      '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', 'POSTGRES_DB=alzad_backup_restore_test',
      '--mount', `type=bind,source=${resolve(dump)},target=/backup.dump,readonly`, POSTGRES_IMAGE]);
    created = true;
    let ready = false;
    const readinessDeadline = Date.now() + 45000;
    while (Date.now() < readinessDeadline) {
      // initdb's temporary Unix-socket server can pass pg_isready before the
      // requested database exists. TCP opens only on the final server; a real
      // query also proves that this exact disposable database is available.
      try { await docker(['exec', name, 'psql', '-h', '127.0.0.1', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'alzad_backup_restore_test', '-At', '-c', 'SELECT 1'], 3000); ready = true; break; }
      catch { await new Promise(resolveWait => setTimeout(resolveWait, 1000)); }
    }
    if (!ready) throw new Error('Isolated restore database did not become ready');
    // The dump recreates public. Remove only the empty initdb schema in our new
    // networkless container (no CASCADE); never clean a restored or remote DB.
    // Technical Supabase policy roles also exist only inside that container.
    await docker(['exec', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'alzad_backup_restore_test', '-c',
      'DROP SCHEMA public; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;']);
    await docker(['exec', name, 'pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '-U', 'postgres',
      '--dbname', 'alzad_backup_restore_test', '/backup.dump']);
    const query = "SELECT coalesce(json_agg(row_to_json(c)), '[]'::json) FROM (SELECT table_name, (xpath('/row/count/text()', query_to_xml(format('SELECT count(*) FROM %I.%I',table_schema,table_name),true,true,'')))[1]::text AS row_count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name) c;";
    const counts = JSON.parse(await docker(['exec', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-U', 'postgres',
      '-d', 'alzad_backup_restore_test', '-c', query]));
    if (!Array.isArray(counts) || !counts.length || counts.some(row => !/^\d+$/.test(row.row_count)) ||
        !counts.some(row => row.table_name === '_prisma_migrations' && Number(row.row_count) > 0)) {
      throw new Error('Restored application database verification failed');
    }
    // The dump's MVCC snapshot is the source of truth for which private objects
    // must be present. Storage may change between pg_dump and S3 enumeration.
    const hasFiles = await docker(['exec', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-U', 'postgres',
      '-d', 'alzad_backup_restore_test', '-c', "SELECT to_regclass('public.files') IS NOT NULL"]);
    const referencedObjects = hasFiles === 't' ? JSON.parse(await docker(['exec', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-U', 'postgres',
      '-d', 'alzad_backup_restore_test', '-c', "SELECT coalesce(json_agg(json_build_object('bucket',bucket,'key',object_key,'sha256',sha256)),'[]'::json) FROM public.files"])) : [];
    if (!Array.isArray(referencedObjects) || referencedObjects.some(item => typeof item.bucket !== 'string' || typeof item.key !== 'string')) {
      throw new Error('Restored file references could not be verified');
    }
    return { status: 'RESTORE_PASS', environment: 'networkless-disposable-postgresql-18', tableCounts: counts, referencedObjects };
  } finally {
    if (created) await docker(['rm', '--force', '--volumes', name]);
  }
}
