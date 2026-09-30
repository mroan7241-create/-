const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PrismaClient } = require('../../platform/packages/db/generated/client');
const { assertTarget, manifestFingerprint, runPreview, runApply, writeManifest } = require('./cleanup-trial-data.cjs');

test('isolated CI DB: stale preview refuses new application, then cleanup preserves protected records',
  { skip: process.env.ALZAD_CLEANUP_INTEGRATION !== 'true', timeout: 240000 }, async () => {
    const target = assertTarget();
    assert.equal(target.kind, 'test');
    const prisma = new PrismaClient();
    const temp = mkdtempSync(path.join(os.tmpdir(), 'alzad-cleanup-'));
    try {
      const before = await runPreview(prisma, target);
      assert.equal(before.protectedRows.admin.n, 1);
      assert.ok(before.protectedRows.adminCredentials.n >= 1);
      const staleManifest = { version: 1, target: 'test', database: target.name,
        sha256: manifestFingerprint(before), data: before };
      const canaryCode = 'APP-CLEANUP-CANARY';
      await prisma.associationApplication.create({ data: {
        publicCode: canaryCode, name: 'Synthetic cleanup guard', region: 'الرياض', city: 'الرياض',
        phone: '0500000000', contactName: 'Synthetic',
      } });
      await assert.rejects(() => runApply(prisma, target, staleManifest,
        { ...process.env, ALZAD_CLEANUP_APPROVED_SHA256: staleManifest.sha256 }), /data changed after preview/);
      await prisma.associationApplication.delete({ where: { publicCode: canaryCode } });

      const approved = await runPreview(prisma, target);
      const manifest = { version: 1, target: 'test', database: target.name,
        sha256: manifestFingerprint(approved), data: approved };
      const manifestPath = path.join(temp, 'approved.json');
      writeManifest(manifestPath, manifest);
      assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).sha256, manifest.sha256);
      const result = await runApply(prisma, target, manifest,
        { ...process.env, ALZAD_CLEANUP_APPROVED_SHA256: manifest.sha256 });
      assert.ok(result.deleted.accounts > 0);
      const after = await runPreview(prisma, target);
      assert.ok(Object.values(after.targets).every(({ n }) => n === 0));
      assert.deepEqual(after.protectedRows, approved.protectedRows);
      assert.equal(after.files.length, 0);
    } finally {
      await prisma.$disconnect();
      rmSync(temp, { recursive: true, force: true });
    }
  });
