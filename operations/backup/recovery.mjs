import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { decryptBuffer } from './backup.mjs';

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'generate-keys' && args.length === 1) {
    // Caller creates and restricts directory permissions first; never overwrite keys.
    const privatePath = join(args[0], 'recovery-private.pem');
    const publicPath = join(args[0], 'encryption-public.pem');
    for (const path of [privatePath, publicPath]) {
      let exists = true; try { await access(path); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
      if (exists) throw new Error('Recovery key destination already exists');
    }
    const pair = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    await writeFile(privatePath, pair.privateKey, { flag: 'wx', mode: 0o600 });
    await writeFile(publicPath, pair.publicKey, { flag: 'wx', mode: 0o600 });
    console.log('Recovery keys created. Keep the private key offline; only public key goes to GitHub.');
  } else if (command === 'decrypt' && args.length >= 3) {
    // Supply parts in their exact numbered order. Authentication rejects missing/reordered parts.
    const [privatePath, outputPath, ...parts] = args;
    const encrypted = Buffer.concat(await Promise.all(parts.map(path => readFile(path))));
    const plaintext = decryptBuffer(encrypted, await readFile(privatePath));
    await writeFile(outputPath, plaintext, { flag: 'wx', mode: 0o600 });
    console.log('Authenticated archive decrypted; no restore executed.');
  } else throw new Error('Usage: generate-keys DIRECTORY | decrypt PRIVATE_KEY OUTPUT_ARCHIVE ORDERED_PARTS...');
} catch {
  console.error('Recovery operation failed; check key, part order and non-existing destination. No values printed.');
  process.exitCode = 1;
}
