import test from 'node:test';
import assert from 'node:assert/strict';
import { kontrollera, andringar } from '../../scripts/lasfil.mjs';
import { bedom } from '../../scripts/audit.mjs';

const pkg = () => ({ version: '1.2.3', resolved: 'https://registry.npmjs.org/exempel/-/exempel-1.2.3.tgz', integrity: 'sha512-' + Buffer.alloc(64, 7).toString('base64') });
const lock = () => ({ lockfileVersion: 3, packages: { '': { dependencies: { exempel: '1.2.3' } }, 'node_modules/exempel': pkg() } });
const manifest = { dependencies: { exempel: '1.2.3' } };
test('dagens form godtas och källor, integritet, länkar och nya skript vägras', () => {
  kontrollera(lock(), manifest);
  for (const resolved of ['https://annan.example/exempel.tgz', 'http://registry.npmjs.org/e.tgz', 'git+https://registry.npmjs.org/e', 'file:../e', 'https://user@registry.npmjs.org/e.tgz']) {
    const l = lock(); l.packages['node_modules/exempel'].resolved = resolved; assert.throws(() => kontrollera(l, manifest));
  }
  for (const changes of [{ integrity: '' }, { hasInstallScript: true }, { link: true }]) {
    const l = lock(); Object.assign(l.packages['node_modules/exempel'], changes); assert.throws(() => kontrollera(l, manifest));
  }
  const l = lock(); l.packages['node_modules/unrs-resolver'] = { ...pkg(), hasInstallScript: true }; kontrollera(l, manifest);
  assert.throws(() => kontrollera(lock(), { dependencies: { exempel: '^1.2.3' } }));
});
test('paketlistan kommer från låsfilerna, även integritets-/skriptändring med samma version', () => {
  const b = lock(), k = lock(); k.packages['node_modules/exempel'].hasInstallScript = true; k.packages['node_modules/ny'] = pkg();
  assert.deepEqual(andringar(b, k), [
    { plats: 'node_modules/exempel', namn: 'exempel', version: '1.2.3', installationsskript: true, andring: 'ändrat', tidigare_version: '1.2.3' },
    { plats: 'node_modules/ny', namn: 'ny', version: '1.2.3', installationsskript: false, andring: 'tillagt', tidigare_version: null },
  ]);
});
const rapport = (severity, title = 'Known vulnerability') => ({ status: severity === 'high' ? 1 : 0, stdout: JSON.stringify({ auditReportVersion: 2,
  vulnerabilities: severity ? { exempel: { severity, via: [{ title }] } } : {},
  metadata: { vulnerabilities: { info: 0, low: severity === 'low' ? 1 : 0, moderate: 0, high: severity === 'high' ? 1 : 0, critical: 0, total: severity ? 1 : 0 } } }) });
test('audit fäller hög risk och skadlig kod också vid låg nivå', () => {
  assert.equal(bedom(rapport()).kod, 0); assert.equal(bedom(rapport('low')).kod, 0);
  assert.equal(bedom(rapport('high')).kod, 1); assert.equal(bedom(rapport('low', 'Malicious package')).kod, 1);
});
test('auditfel och ofullständiga svar är okända och stoppar', () => {
  for (const r of [{ status: 1, stdout: '{"error":{"code":"EAI_AGAIN"}}' }, { status: 0, stdout: 'not json' },
    { ...rapport(), error: Error('timeout') }, { ...rapport(), status: 1 }, { ...rapport(), signal: 'SIGTERM' },
    { status: 0, stdout: '{"auditReportVersion":2,"vulnerabilities":{},"metadata":{"vulnerabilities":{"high":0,"critical":0}}}' }]) {
    assert.deepEqual(bedom(r), { kod: 2, lage: 'kunde inte kontrolleras' });
  }
});
