import test from 'node:test';
import assert from 'node:assert/strict';
import { kontrollera, andringar } from '../../scripts/lasfil.mjs';
import { bedom } from '../../scripts/audit.mjs';
import { provaAlder, lasUndantag, registerTid } from '../../scripts/paketalder.mjs';
import { readFileSync } from 'node:fs';

const pkg = () => ({ version: '1.2.3', resolved: 'https://registry.npmjs.org/exempel/-/exempel-1.2.3.tgz', integrity: 'sha512-' + Buffer.alloc(64, 7).toString('base64') });
const lock = () => ({ lockfileVersion: 3, packages: { '': { dependencies: { exempel: '1.2.3' } }, 'node_modules/exempel': pkg() } });
const manifest = { dependencies: { exempel: '1.2.3' } };
test('transitiva alias kan inte låna annat pakets publiceringstid eller undantag', () => {
  const l = lock(); l.packages['node_modules/exempel'].name = 'annat';
  assert.throws(() => kontrollera(l, manifest), /paketalias/);
  l.packages['node_modules/exempel'].name = 'exempel';kontrollera(l, manifest);
  l.packages['node_modules/exempel/node_modules/alias'] = { ...pkg(), name: 'annat' };
  assert.throws(() => kontrollera(l, manifest), /paketalias/);
});
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

const nu = Date.parse('2026-09-30T12:00:00Z');
const changes = [{ namn: 'exempel', version: '1.2.3', plats: 'node_modules/exempel' }];
const inga = { schema: 1, undantag: [] };
test('tre dagar fälls, åtta och exakt sju dagar godtas med namn/version/ålder', async () => {
  for (const [days, expected] of [[3, false], [8, true], [7, true]]) {
    const result = await provaAlder(changes, inga, { nu, lasTid: async () => new Date(nu - days * 86400000).toISOString() });
    assert.equal(result.godkand, expected);
    assert.equal(result.paketandringar[0].namn, 'exempel'); assert.equal(result.paketandringar[0].version, '1.2.3');
    assert.equal(result.paketandringar[0].karenstid.alder_dagar, days);
  }
});
test('undantaget är exakt och synligt i ändringslistan; uppslagsfel förblir okänt', async () => {
  const row = { paket: 'exempel', version: '1.2.3', skal: 'syntetisk brådskande rättelse', datum: '2026-09-30' };
  const undantag = { schema: 1, undantag: [row] };
  const r = await provaAlder(changes, undantag, { nu, lasTid: async () => '2026-09-27T12:00:00Z' });
  assert.equal(r.godkand, true); assert.deepEqual(r.paketandringar[0].karenstid.undantag, row);
  const failed = await provaAlder(changes, undantag, { nu, lasTid: async () => { throw Error('synthetic'); } });
  assert.equal(failed.godkand, false); assert.equal(failed.paketandringar[0].karenstid.lage, 'kunde inte kontrolleras');
  for (const changed of [{ ...row, version: '1.2.4' }, { ...row, paket: 'annat' }]) {
    const v = await provaAlder(changes, { schema: 1, undantag: [changed] }, { nu, lasTid: async () => '2026-09-27T12:00:00Z' });
    assert.equal(v.godkand, false);
  }
  for (const bad of [null, { schema: 1, undantag: [row, row] }, { schema: 1, undantag: [{ ...row, skal: '' }] },
    { schema: 1, undantag: [{ ...row, datum: '2026-02-31' }] }]) assert.throws(() => lasUndantag(bad, nu));
});
test('saknad eller felaktig tid stoppar, identiska versioner efterfrågas en gång', async () => {
  for (const value of [null, '', 'invalid', '2026-02-31T12:00:00Z']) {
    const r = await provaAlder(changes, inga, { nu, lasTid: async () => value });
    assert.equal(r.godkand, false); assert.equal(r.paketandringar[0].karenstid.lage, 'kunde inte kontrolleras');
  }
  let calls = 0;
  const r = await provaAlder([...changes, ...changes], inga, { nu, lasTid: async () => { calls++; return '2026-09-22T12:00:00Z'; } });
  assert.equal(r.godkand, true); assert.equal(calls, 1); assert.equal(r.paketandringar.length, 2);
});
test('registerläsningen binder paket och version samt vägrar redirect och saknade fält', async t => {
  const calls = [];
  const stub = t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options]);
    return new Response(JSON.stringify({ name: '@scope/example', time: { '1.2.3': '2026-09-22T12:00:00Z' } }), { status: 200 });
  });
  assert.equal(await registerTid('@scope/example', '1.2.3'), '2026-09-22T12:00:00Z');
  assert.equal(calls[0][0], 'https://registry.npmjs.org/%40scope%2Fexample');
  assert.equal(calls[0][1].redirect, 'error'); assert.equal(calls[0][1].headers.Accept, 'application/json');
  assert.ok(calls[0][1].signal);
  await assert.rejects(registerTid('@scope/example', '9.9.9'));
  stub.mock.mockImplementation(async () => new Response('{}', { status: 302 }));
  await assert.rejects(registerTid('example', '1.2.3'));
});
test('åldersgrinden ligger före installation och paketkod i CI och före lokalt bygge', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.indexOf('node scripts/lasfil.mjs') < ci.indexOf('run: npm ci'));
  for (const name of ['lint', 'test:core', 'build']) assert.ok(ci.indexOf('node scripts/lasfil.mjs') < ci.indexOf(`npm run ${name}`));
  const local = readFileSync(new URL('../../scripts/prov.mjs', import.meta.url), 'utf8');
  assert.ok(local.indexOf("scripts/lasfil.mjs") < local.indexOf("['run', '-s', 'build']"));
});
