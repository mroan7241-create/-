// Next.js `output: standalone` does not copy `public/` or `.next/static`
// into the standalone bundle automatically — this is documented upstream
// behavior, not a bug. Both the Hostinger dispatcher and a manual
// `node .next/standalone/apps/web/server.js` run need these present
// alongside server.js, so this runs as a `postbuild` step after every build.
const fs = require('node:fs');
const path = require('node:path');

const webRoot = path.join(__dirname, '..');
const standaloneWebRoot = path.join(webRoot, '.next', 'standalone', 'apps', 'web');

if (!fs.existsSync(standaloneWebRoot)) {
  console.warn(`[copy-standalone-assets] ${standaloneWebRoot} not found, skipping.`);
  process.exit(0);
}

fs.cpSync(path.join(webRoot, 'public'), path.join(standaloneWebRoot, 'public'), {
  recursive: true,
});
fs.cpSync(path.join(webRoot, '.next', 'static'), path.join(standaloneWebRoot, '.next', 'static'), {
  recursive: true,
});

console.log('[copy-standalone-assets] copied public/ and .next/static into standalone output.');
