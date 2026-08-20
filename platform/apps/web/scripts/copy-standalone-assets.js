// Next.js `output: standalone` does not copy `public/` or the generated static
// assets directory
// into the standalone bundle automatically — this is documented upstream
// behavior, not a bug. Both the Hostinger dispatcher and a manual
// `node next-build/standalone/apps/web/server.js` run need these present
// alongside server.js, so this runs as a `postbuild` step after every build.
const fs = require('node:fs');
const path = require('node:path');

const webRoot = path.join(__dirname, '..');
const distDir = 'next-build';
const standaloneWebRoot = path.join(webRoot, distDir, 'standalone', 'apps', 'web');

if (!fs.existsSync(standaloneWebRoot)) {
  console.warn(`[copy-standalone-assets] ${standaloneWebRoot} not found, skipping.`);
  process.exit(0);
}

fs.cpSync(path.join(webRoot, 'public'), path.join(standaloneWebRoot, 'public'), {
  recursive: true,
});
fs.cpSync(path.join(webRoot, distDir, 'static'), path.join(standaloneWebRoot, distDir, 'static'), {
  recursive: true,
});

console.log('[copy-standalone-assets] copied public/ and generated static assets into standalone output.');
