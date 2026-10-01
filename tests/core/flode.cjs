/* eslint-disable @typescript-eslint/no-require-imports -- CJS-loadern ersätter endast provets transportmoduler. */
// Fasmaskinen i intervjuformatet (intro → intervju → avslut → granskning → inlamnat), samtycket vid inlämning, den
// deterministiska sammanställningen och exportens bakåtkompatibilitet. Blob är en transportdubbel i minnet. Allt körs
// modellfritt (standardlistan), så varje modellanrop vore ett fel.
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const docs = new Map(); let seq = 0;
class BlobPreconditionFailedError extends Error {}
const blob = {
  BlobPreconditionFailedError,
  async put(p, body, o) { const old = docs.get(p); if (o.ifMatch && old?.etag !== o.ifMatch) throw new BlobPreconditionFailedError(); if (old && o.allowOverwrite === false) throw new Error('exists'); const etag = '"' + ++seq + '"'; docs.set(p, { body: typeof body === 'string' ? body : Buffer.from(body), etag }); return { etag, pathname: p }; },
  async get(p) { const v = docs.get(p); return v ? { stream: new Response(v.body).body, blob: { etag: v.etag, size: v.body.length, contentType: 'application/json' } } : null; },
  async del(p) { docs.delete(p); },
  async list({ prefix, cursor, limit }) { const keys = [...docs.keys()].filter((k) => k.startsWith(prefix)).sort(); const start = Number(cursor || 0); return { blobs: keys.slice(start, start + limit).map((pathname) => ({ pathname })), hasMore: start + limit < keys.length, cursor: String(start + limit) }; },
};
const originalLoad = Module._load; Module._load = function (id, ...args) { return id === '@vercel/blob' ? blob : originalLoad.call(this, id, ...args); };
delete process.env.KUNDSTART_AI; // standardlistan överallt
process.env.KUNDSTART_AVSLUT_EFTER_FRAGOR = '4'; // kort intervju i provet
global.fetch = async () => { throw new Error('inget modellanrop får ske i det modellfria flödet'); };
const A = require('../../lib/arende.ts'), O = require('../../lib/overlamning.ts'), V = require('../../lib/vy.ts'), S = require('../../lib/samtycke.ts'), T = require('../../lib/tackning.ts');
const tests = []; const test = (name, fn) => tests.push({ name, fn });
let nr = 0; const nyckel = (p) => p + String(++nr).padStart(6, '0');
async function arende() { const { a } = await A.skapaArende({ kund: { slug: 'flodesprov', namn: 'Flödesprov TEST' }, testdialog: true, ai: 'regelstyrd', fakta: [{ nyckel: 'erbjudande', varde: 'Cykelservice', status: 'kunden uppger', kalla: 'äldre underlag', omrade: 'A' }] }); return a; }
const samtycke = () => ({ ...S.SAMTYCKE, bekraftat: true, transkript_last: true });
const oppen = (a) => a.fragor.find((f) => f.status === 'stalld');
/** Svarar på den öppna frågan och hämtar nästa. */
async function svara(id, text) {
  const a = await A.lasArende(id);
  const f = oppen(a);
  assert(f, 'en öppen fråga finns');
  await A.registreraSvar(id, { fraga_id: f.id, text, typ: 'text', idempotens: nyckel('SV') });
  return (await A.nasta(id)).a;
}
const SVAR = ['Vi är en cykelverkstad i Umeå och vill få fler bokade servicetider.', 'Mest privatpersoner som ringer eller kommer förbi.', 'Vi ringer tillbaka samma dag.', 'Vi använder Fortnox och en pappersalmanacka.'];

test('Ett nytt ärende står i intro; börja är idempotent och ställer öppningsfrågan utan modell; nasta i intro frågar inget', async () => {
  const a = await arende();
  assert.equal(A.fasAv(a), 'intro');
  assert.equal((await A.nasta(a.id)).fragor.length, 0);
  assert.equal((await A.lasArende(a.id)).fragor.length, 0, 'ingen fråga före "Börja intervjun"');
  const b = await A.borja(a.id);
  assert.equal(b.ny, true);
  assert.equal(b.a.fragor[0].id, 'AG1'); assert.equal(b.a.fragor[0].roll, 'oppning'); assert.equal(b.a.fragor[0].inledning, A.OPPNING_INLEDNING);
  assert.equal(A.fasAv(b.a), 'intervju');
  assert.deepEqual(b.a.fas_historik.map((h) => h.fran + '>' + h.till + ':' + h.av), ['null>intervju:kund']);
  assert.equal((await A.borja(a.id)).ny, false, 'börja igen ändrar inget');
  assert.equal(A.exportPaket(b.a).fas, 'intervju');
  assert.equal(V.tillVy(b.a).oppna[0].id, 'AG1');
});

test('Standardlistan rundar av vid frågegränsen med fast text och avslutsfråga; sista tankar behåller avslutet', async () => {
  const a = await arende();
  await A.borja(a.id);
  let b;
  for (const text of SVAR) b = await svara(a.id, text);
  assert.equal(A.fasAv(b), 'avslut');
  assert.equal(b.samtal_klar.valjare, 'regelstyrd');
  assert.match(b.samtal_klar.meddelande, /^Tack\. Ni har svarat på 4 frågor om /);
  assert.match(b.samtal_klar.meddelande, /Nu sammanställer vi det ni berättat/);
  const avslut = oppen(b);
  assert.equal(avslut.roll, 'avslut'); assert.equal(avslut.nyckel, 'avslut'); assert.equal(avslut.inledning, b.samtal_klar.meddelande);
  assert.equal(avslut.id, 'AG2', 'avslutsfrågan får nästa AG-id');
  const { a: c } = await A.registreraSvar(a.id, { fraga_id: avslut.id, text: 'Nej, det var allt.', typ: 'text', idempotens: nyckel('SV') });
  assert(c.samtal_klar, 'sista tankar öppnar inte samtalet igen'); assert.equal(A.fasAv(c), 'avslut');
  const r = await A.nasta(a.id);
  assert.equal(r.fragor.length, 0); assert.equal(r.klar, true);
  assert(!A.bild(c).some((x) => x.nyckel === 'avslut'), 'sista tankar är ingen uppgift i bilden');
  assert(!T.tackning(c).some((x) => x.nyckel === 'avslut'), 'avslutsfrågan är inget bankämne');
  // Granskning: sammanfattningen skrivs en gång, deterministiskt, med kundens ord ordagrant.
  const g = await A.granska(a.id);
  assert.equal(g.utford, true); assert.equal(A.fasAv(g.a), 'granskning');
  const s = g.a.syntes;
  assert.equal(s.status, 'klar'); assert.equal(s.valjare, 'regelstyrd'); assert.equal(s.id, 'S' + g.a.revision);
  for (const text of SVAR) assert(s.sammanfattning.includes('”' + text + '”'), 'ordagrant: ' + text);
  assert(s.sammanfattning.includes('Ert tillägg: ”Nej, det var allt.”'));
  assert(s.oppet.length > 0 && s.oppet.length <= 8); assert(s.oppet.every((o) => o.nyckel && o.varfor));
  assert.deepEqual(A.syntesRegelstyrd(g.a), A.syntesRegelstyrd(g.a), 'deterministisk');
  const igen = await A.granska(a.id);
  assert.equal(igen.utford, false); assert.equal(igen.a.syntes.id, s.id, 'en aktuell sammanfattning skrivs inte om');
  assert.equal(A.exportPaket(igen.a).syntes.id, s.id);
  // Rättelse gör sammanfattningen inaktuell; "igen" ger en ny.
  const { a: d } = await A.registreraRattelse(a.id, { nyckel: 'erbjudande', varde: 'Cykelservice och uthyrning', idempotens: nyckel('RA') });
  assert(A.kundRevision(d) > d.syntes.bas_revision, 'kundens ändring är nyare än sammanfattningen');
  const ny = await A.granska(a.id, { igen: true });
  assert.equal(ny.utford, true); assert.notEqual(ny.a.syntes.id, s.id); assert.equal(A.fasAv(ny.a), 'granskning');
  // Inlämning kräver samtycke med exakt text; sedan är ärendet inlämnat, signalerat och idempotent.
  await assert.rejects(A.lamnaIn(a.id, { idempotens: nyckel('IN') }), (e) => e.status === 422);
  await assert.rejects(A.lamnaIn(a.id, { idempotens: nyckel('IN'), samtycke: { ...samtycke(), text: 'Jag godkänner.' } }), (e) => e.status === 422);
  await assert.rejects(A.lamnaIn(a.id, { idempotens: 'kort', samtycke: samtycke() }), /idempotensnyckel/);
  const inKey = nyckel('IN');
  const e = await A.lamnaIn(a.id, { idempotens: inKey, samtycke: samtycke() });
  assert.equal(A.fasAv(e), 'inlamnat'); assert.equal(e.signal.typ, 'inlamning');
  assert.equal(e.inlamningar.length, 1); assert.equal(e.inlamningar[0].samtycke.version, 'samtycke/1'); assert.equal(e.inlamningar[0].samtycke.text, S.SAMTYCKE.text);
  assert.equal(e.inlamningar[0].samtycke.syntes_id, ny.a.syntes.id); assert.equal(e.inlamningar[0].samtycke.idempotens, inKey);
  const f = await A.lamnaIn(a.id, { idempotens: inKey, samtycke: samtycke() });
  assert.equal(f.inlamningar.length, 1, 'samma nyckel igen ger ingen ny inlämning');
  assert.equal(V.tillVy(f).overforing, 'vantar');
  const tr = A.transkript(f);
  assert.equal(tr[0].roll, 'oppning'); assert.equal(tr.at(-1).roll, 'avslut'); assert.equal(tr.at(-1).svar.text, 'Nej, det var allt.');
  assert.equal(tr.filter((x) => x.svar).length, 5);
  // Returfrågor från Digitala öppnar samtalet; sista svaret leder tillbaka till granskningen med inaktuell sammanfattning.
  const g2 = await O.returfragor(a.id, { idempotens: nyckel('RET'), bas_revision: f.revision, utforare: 'digitala/prov', fragor: [{ nyckel: 'buffert', text: 'Hur lång tid behöver ni mellan två servicetider?', paverkar: 'bokningens upplägg' }] });
  assert.equal(A.fasAv(g2), 'intervju'); assert.equal(g2.fas_historik.at(-1).av, 'digitala');
  const ret = oppen(g2);
  const { a: h } = await A.registreraSvar(a.id, { fraga_id: ret.id, text: '30 minuter.', typ: 'text', idempotens: nyckel('SV') });
  assert.equal(A.fasAv(h), 'granskning'); assert.equal(h.syntes.status, 'inaktuell');
  assert.equal(V.tillVy(h).overforing, 'andrat_efter');
  const i = await A.lamnaIn(a.id, { idempotens: nyckel('IN'), samtycke: samtycke() });
  assert.equal(i.inlamningar.length, 2); assert.equal(A.fasAv(i), 'inlamnat');
});

test('Kunden kan avsluta själv; "berätta mer" öppnar samtalet igen, stänger avslutsfrågan och gör sammanfattningen inaktuell', async () => {
  const a = await arende();
  await A.borja(a.id);
  const b = await svara(a.id, SVAR[0]);
  const fraga2 = oppen(b);
  assert(fraga2 && fraga2.roll !== 'avslut');
  await assert.rejects(A.lamnaIn(a.id, { idempotens: nyckel('IN'), samtycke: samtycke() }), (e) => e.status === 409, 'inlämning kräver genomläsning');
  const c = await A.avsluta(a.id);
  assert.equal(c.ny, true); assert.equal(A.fasAv(c.a), 'avslut'); assert.equal(c.a.samtal_klar.valjare, 'kund');
  assert.equal(c.a.fragor.find((f) => f.id === fraga2.id).status, 'senare', 'den obesvarade frågan skjuts upp, inte bort');
  assert.match(c.a.samtal_klar.meddelande, /svarat på 1 fråga/);
  assert.equal(oppen(c.a).roll, 'avslut');
  assert.equal((await A.avsluta(a.id)).ny, false);
  assert.equal((await A.nasta(a.id)).fragor[0].roll, 'avslut', 'nasta i avslut ställer inget nytt');
  const g = await A.granska(a.id);
  assert.equal(A.fasAv(g.a), 'granskning'); assert.equal(g.a.syntes.status, 'klar');
  assert.equal(g.a.fragor.find((f) => f.roll === 'avslut').status, 'tackt', 'obesvarad avslutsfråga stängs');
  assert(A.transkript(g.a).some((x) => x.roll === 'avslut' && x.svar === null), 'avslutsfrågan står kvar i transkriptet');
  assert.equal(g.a.fragor.find((f) => f.id === fraga2.id).status, 'senare');
  assert(V.tillVy(g.a).uppdrag.senare.some((s) => s.id === fraga2.id), 'den uppskjutna frågan kan tas upp igen i granskningen');
  const r = await A.nasta(a.id, { fortsatt: true });
  assert.equal(A.fasAv(r.a), 'intervju'); assert.equal(r.a.samtal_klar, null); assert.equal(r.a.syntes.status, 'inaktuell');
  assert.equal(r.fragor.length, 1); assert.notEqual(r.fragor[0].roll, 'avslut');
  assert.equal((await A.nasta(a.id)).fragor[0].id, r.fragor[0].id, 'samma fråga tills den besvaras');
});

test('Skrivet "vet inte" som hela svaret sparas som vet_inte; en delsats förblir text; "Svara nu" efter sammanfattning går tillbaka till granskningen', async () => {
  const a = await arende();
  await A.borja(a.id);
  const { a: b } = await A.registreraSvar(a.id, { fraga_id: 'AG1', text: 'Vet inte.', typ: 'text', idempotens: nyckel('SV') });
  assert.equal(b.svar[0].typ, 'vet_inte'); assert.equal(b.svar[0].text, 'Vet inte.');
  assert.equal(T.tackning(b).find((t) => t.nyckel === 'verksamhetsmal').status, 'kunden_vet_inte');
  const c = (await A.nasta(a.id)).a;
  const { a: d } = await A.registreraSvar(a.id, { fraga_id: oppen(c).id, text: 'Vi vet inte vad vi har för statistik, men vi vill ha fler kunder.', typ: 'text', idempotens: nyckel('SV') });
  assert.equal(d.svar[1].typ, 'text');
  assert(oppen((await A.nasta(a.id)).a), 'nästa fråga ställs');
  await A.avsluta(a.id);
  const g = await A.granska(a.id);
  const senare = g.a.fragor.find((f) => f.status === 'senare');
  assert(senare, 'den uppskjutna frågan kan tas upp igen');
  const o = await A.oppnaIgen(a.id, senare.id);
  assert.equal(A.fasAv(o), 'intervju');
  const { a: e } = await A.registreraSvar(a.id, { fraga_id: senare.id, text: 'Nu vet vi: tio bokningar i veckan.', typ: 'text', idempotens: nyckel('SV') });
  assert.equal(A.fasAv(e), 'granskning', 'tillbaka till granskningen när inget mer står öppet');
  assert.equal(e.syntes.status, 'inaktuell');
});

test('Exporten behåller kundstart-export/1 med alla tidigare nycklar; ett ärende från 133f37f härleder sin fas och exporterar', async () => {
  const a = await arende();
  const ex = A.exportPaket(a);
  assert.equal(ex.schema, 'kundstart-export/1');
  const tidigare = ['schema', 'exporterad', 'arende', 'bank', 'signal', 'kvittenser', 'returfragor', 'behov', 'tackning', 'ai', 'fakta_forifyllda', 'omgangar', 'svar', 'rattelser', 'fakta_ai', 'rattelser_fakta', 'kunduppgifter', 'tillval', 'research', 'tackning_agent', 'samtal_klar', 'material', 'foljdregler_utlosta', 'foljdregler_negerade', 'handelser'];
  for (const k of tidigare) assert(k in ex, 'tidigare nyckel finns: ' + k);
  for (const k of ['fas', 'fas_historik', 'syntes', 'transkript', 'berorda']) assert(k in ex, 'ny nyckel finns: ' + k);
  assert.equal(ex.fas, 'intro'); assert.equal(ex.syntes, null); assert.deepEqual(ex.transkript, []);
  const fix = JSON.parse(fs.readFileSync(__dirname + '/fixtur-arende-133f37f.json', 'utf8')).arende;
  docs.set('arenden/' + fix.id + '.json', { body: JSON.stringify(fix), etag: '"fixtur"' });
  const g = await A.lasArende(fix.id);
  assert.equal(g.fas, undefined, 'fixturen saknar fas');
  assert(['intro', 'intervju', 'avslut', 'granskning', 'inlamnat'].includes(A.fasAv(g)));
  const ex2 = A.exportPaket(g);
  assert.equal(ex2.fas, A.fasAv(g)); assert(ex2.transkript.length > 0);
  assert.equal(V.tillVy(g).oppna[0].id, 'BOK1');
  const { a: h } = await A.registreraSvar(fix.id, { fraga_id: 'BOK1', text: 'Service, däckbyte och vinterförvaring.', typ: 'text', idempotens: nyckel('SV') });
  assert.equal(A.fasAv(h), 'intervju'); assert.equal(h.fas, 'intervju', 'fasen skrivs vid första övergången');
  assert.equal((await A.nasta(fix.id)).fragor.length, 1, 'standardlistan fortsätter det gamla ärendet');
});

(async () => {
  const result = [];
  for (const t of tests) {
    try { await t.fn(); result.push({ namn: t.name, ok: true }); console.log('PASS', t.name); }
    catch (e) { result.push({ namn: t.name, ok: false, fel: e.stack }); console.error('FAIL', t.name, e); }
  }
  const receipt = { tid: new Date().toISOString(), omfattning: 'Fasmaskinen, samtycket, den deterministiska sammanställningen och exportens kompatibilitet med kontrollerad Blob-ersättare. Inte leverantörsprov.', resultat: result, complete: result.every((r) => r.ok) };
  if (process.env.KUNDSTART_PROVKVITTO_FLODE) fs.writeFileSync(process.env.KUNDSTART_PROVKVITTO_FLODE, JSON.stringify(receipt, null, 2));
  process.exit(receipt.complete ? 0 : 1);
})();
