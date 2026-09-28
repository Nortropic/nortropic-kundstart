/* eslint-disable @typescript-eslint/no-require-imports -- CJS-loadern ersätter endast provets transportmoduler. */
// Kontraktsprov för intervjuagenten, tillvalen, domänkontrollen och kostnadsspärren. Blob, modell och DNS är
// kontrollerade transportdubblar i minnet; inga leverantörsanrop görs. Verkliga modellkörningar provas separat.
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
process.env.AI_GATEWAY_API_KEY = 'provnyckel-ingen-leverantor';
const A = require('../../lib/arende.ts'), AG = require('../../lib/agent.ts'), MO = require('../../lib/modell.ts'), B = require('../../lib/budget.ts'), D = require('../../lib/doman.ts'), T = require('../../lib/tackning.ts'), V = require('../../lib/vy.ts');
const tests = []; const test = (name, fn) => tests.push({ name, fn });
const vanta = (ms) => new Promise((r) => setTimeout(r, ms));
async function arende(ai = 'gateway') { const { a } = await A.skapaArende({ kund: { slug: 'agentprov', namn: 'Agentprov TEST' }, testdialog: true, ai, fakta: [{ nyckel: 'erbjudande', varde: 'Cykelservice', status: 'kunden uppger', kalla: 'äldre underlag', omrade: 'A' }] }); return a; }
const SVAR1 = 'Vi är en cykelverkstad i Umeå. Vi vill att kunderna ska kunna boka service själva. Vi har domänen testcykel.se hos Loopia. Vi vet inte vad vi har för statistik.';
async function medSvar(ai = 'gateway') {
  let a = await arende(ai);
  a = (await A.nasta(a.id)).a;
  assert.equal(a.fragor[0].id, 'AG1');
  return (await A.registreraSvar(a.id, { fraga_id: 'AG1', text: SVAR1, typ: 'text', idempotens: 'SVARAG1X' })).a;
}
function agentUt(over = {}) {
  return { aterkoppling: 'Ni vill att kunderna bokar själva.', fraga: { text: 'Vilka tjänster ska kunna bokas?', nyckel: 'bokning_tjanster', omrade: 'C', varfor: 'bokningens upplägg', form: 'oppen', alternativ: [], tillval: [] }, uppgifter: [], behov: [], tillval: [], tackning: [], research: [], klar: false, ...over };
}
const kundensBesked = (tillval, kundval, citat, kalla_id = 'AG1', system = '') => ({ tillval, grund: 'kundens_besked', kundval, system, citat, kalla_id, motivering: '' });
const rekommendation = (tillval, motivering) => ({ tillval, grund: 'rekommendation', kundval: 'ingen', system: '', citat: '', kalla_id: '', motivering });
function gateway(ut, opts = {}) {
  const anrop = [];
  global.fetch = async (url, init) => {
    anrop.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    if (opts.fore) await opts.fore(anrop.length);
    if (opts.fel && anrop.length <= opts.fel.length) return opts.fel[anrop.length - 1]();
    const u = typeof ut === 'function' ? ut(anrop.length) : ut;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(u) } }], usage: { prompt_tokens: 4000, completion_tokens: 900, cost: 0.0028 } }), { status: 200 });
  };
  return anrop;
}

test('Öppningsfrågan är fast och ställs utan modellanrop', async () => {
  const anrop = gateway(agentUt());
  const a = await arende();
  const r = await A.nasta(a.id);
  assert.equal(anrop.length, 0);
  assert.equal(r.fragor[0].id, 'AG1'); assert.equal(r.fragor[0].kalla, 'agent'); assert.equal(r.fragor[0].valjare, 'regelstyrd');
});

test('Agentens schema är strikt; varje notering kräver ordagrant citat ur kundens svar eller material', async () => {
  assert.equal(AG.AGENT_SCHEMA.additionalProperties, false);
  assert.deepEqual([...AG.AGENT_SCHEMA.required].sort(), ['aterkoppling', 'behov', 'fraga', 'klar', 'research', 'tackning', 'tillval', 'uppgifter'].sort());
  const a = await medSvar();
  const k = AG.byggKontext(a, { kanda: [], tackning: [], utlosta: [], aterstarAnrop: 10 });
  const ut = AG.validera(agentUt({
    fraga: { text: 'Vilket system?', nyckel: 'system', omrade: 'D', varfor: 'x', form: 'val', alternativ: ['Bara ett'], tillval: [] },
    uppgifter: [
      { nyckel: 'erbjudande', rubrik: 'Verksamhet', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Vi är en cykelverkstad i Umeå.', kalla_id: 'AG1', sammanfattning: '' },
      { nyckel: 'hittepa', rubrik: 'Påhitt', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Vi har tre butiker.', kalla_id: 'AG1', sammanfattning: '' },
    ],
    tillval: [
      kundensBesked('bokning', 'onskat', 'Vi vill att kunderna ska kunna boka service själva.'),
      kundensBesked('rymdfarkost', 'onskat', 'Vi vill att kunderna ska kunna boka service själva.'),
      kundensBesked('crm', 'har_system', 'hos Loopia'),
      rekommendation('foretagsprofil', 'Lokala kunder söker på kartan.'),
    ],
    tackning: [{ nyckel: 'data', lage: 'kunden_vet_inte', citat: 'Vi vet inte vad vi har för statistik.', kalla_id: 'AG1' }],
    research: [{ fraga: 'Vad erbjuder konkurrenterna?', varfor: 'x', nyckel: '', citat: 'påhittat', kalla_id: 'kand' }],
  }), k);
  assert(ut);
  assert.deepEqual(ut.uppgifter.map((u) => u.nyckel), ['erbjudande']);
  assert.equal(ut.uppgifter[0].status, 'kunden uppger'); assert.equal(ut.uppgifter[0].varde, 'Vi är en cykelverkstad i Umeå.');
  assert.deepEqual(ut.tillval_val.map((t) => t.tillval), ['bokning']);
  assert.equal(ut.tillval_rekommendation.length, 1); assert.equal(ut.tackning[0].lage, 'kunden_vet_inte');
  assert.equal(ut.research.length, 0);
  assert.equal(ut.fraga.form, 'oppen', 'ett ensamt alternativ blir öppen fråga');
  assert.deepEqual(ut.avvisade.map((x) => x.orsak).sort(), ['citat_saknas_i_kallan', 'okant_tillval', 'saknar_ordagrant_kallstod', 'system_saknas'].sort());
  assert.equal(AG.validera({ ...agentUt(), klar: 'ja' }, k), null, 'fel form förkastas helt');
});

test('En agenttur tillämpar kundens tillval, rekommendation, vet inte och research; frågan får serverns id', async () => {
  const a = await medSvar();
  const anrop = gateway(agentUt({
    uppgifter: [{ nyckel: 'erbjudande', rubrik: 'Verksamhet', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Vi är en cykelverkstad i Umeå.', kalla_id: 'AG1', sammanfattning: '' }],
    tillval: [kundensBesked('bokning', 'onskat', 'Vi vill att kunderna ska kunna boka service själva.'), rekommendation('foretagsprofil', 'Lokala kunder söker på kartan.')],
    tackning: [{ nyckel: 'data', lage: 'kunden_vet_inte', citat: 'Vi vet inte vad vi har för statistik.', kalla_id: 'AG1' }],
    research: [{ fraga: 'Hur tar verkstäder i Umeå emot bokningar?', varfor: 'nivå', nyckel: '', citat: 'cykelverkstad i Umeå', kalla_id: 'AG1' }],
  }));
  const r = await A.nasta(a.id);
  assert.equal(anrop.length, 1); assert(anrop[0].url.endsWith('/v1/chat/completions'));
  assert.equal(anrop[0].body.response_format.json_schema.strict, true);
  assert.equal(r.fragor[0].id, 'AG2'); assert.equal(r.fragor[0].valjare, 'ai'); assert.equal(r.fragor[0].inledning, 'Ni vill att kunderna bokar själva.');
  const b = await A.lasArende(a.id);
  const bokning = b.tillval.find((t) => t.id === 'bokning');
  assert.equal(bokning.kundval, 'onskat'); assert.equal(bokning.kalla, 'samtal'); assert.equal(bokning.fraga_id, 'AG1');
  assert.equal(b.tillval.find((t) => t.id === 'foretagsprofil').kundval, null, 'rekommendation blir aldrig kundens val');
  assert.equal(T.tackning(b).find((t) => t.nyckel === 'data').status, 'kunden_vet_inte');
  assert.equal(b.research[0].status, 'bestalld');
  assert.equal(b.ai.kostnad_usd, 0.0028, 'gatewayens faktiska usage.cost bokförs');
  const vy = V.tillVy(b);
  assert(vy.uppdrag.valda.some((t) => t.id === 'bokning')); assert(vy.uppdrag.rekommenderade.some((t) => t.id === 'foretagsprofil'));
  const ex = A.exportPaket(b);
  assert.equal(ex.kunduppgifter[0].citat, 'Vi är en cykelverkstad i Umeå.'); assert.equal(ex.kunduppgifter[0].kalla_id, 'AG1');
  assert(ex.tillval.some((t) => t.id === 'bokning' && t.kundval === 'onskat')); assert.equal(ex.research.length, 1);
  assert.equal(ex.ai.pagaende, undefined, 'låset exporteras inte');
});

test('Kundens citat avgör tillvalet; domänresearch, frågor till kunden och "vi vet inte" som uppgift avvisas eller blir okänt', async () => {
  const a = await medSvar();
  const k = AG.byggKontext(a, { kanda: [], tackning: [], utlosta: [], aterstarAnrop: 10 });
  const ut = AG.validera(agentUt({
    uppgifter: [
      { nyckel: 'data', rubrik: 'Statistik', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Vi vet inte vad vi har för statistik.', kalla_id: 'AG1', sammanfattning: '' },
      { nyckel: 'erbjudande', rubrik: 'Verksamhet', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Vi är en cykelverkstad i Umeå.', kalla_id: 'AG1', sammanfattning: '' },
    ],
    tillval: [
      // Modellen kallar det rekommendation men citerar kundens eget önskemål: kundens ord vinner.
      { tillval: 'bokning', grund: 'rekommendation', kundval: 'onskat', system: '', citat: 'Vi vill att kunderna ska kunna boka service själva.', kalla_id: 'AG1', motivering: 'Ni vill att kunderna bokar själva.' },
      // Påstått kundbesked utan kundens ord blir bara en rekommendation.
      { tillval: 'betalning', grund: 'kundens_besked', kundval: 'onskat', system: '', citat: 'Vi vill ta betalt i förskott.', kalla_id: 'AG1', motivering: 'Deposition minskar uteblivna besök.' },
      kundensBesked('doman', 'har_system', 'Vi har domänen testcykel.se hos Loopia.', 'AG1', 'testcykel.se'),
      rekommendation('doman', 'Ni bör ha en egen adress.'),
    ],
    research: [
      { fraga: 'Vilka öppna DNS-uppgifter finns för testcykel.se?', varfor: 'x', nyckel: '', citat: 'testcykel.se', kalla_id: 'AG1' },
      { fraga: 'Vilket bokningssystem använder ni i dag?', varfor: 'x', nyckel: '', citat: 'boka service själva', kalla_id: 'AG1' },
      { fraga: 'Hur tar cykelverkstäder i Umeå emot bokningar på nätet?', varfor: 'nivå', nyckel: '', citat: 'cykelverkstad i Umeå', kalla_id: 'AG1' },
    ],
  }), k);
  assert(ut);
  assert.deepEqual(ut.tillval_val.map((t) => t.tillval + ':' + t.kundval + ':' + t.system), ['bokning:onskat:', 'doman:har_system:testcykel.se']);
  assert.deepEqual(ut.tillval_rekommendation.map((t) => t.tillval), ['betalning']);
  assert.deepEqual(ut.uppgifter.map((u) => u.nyckel), ['erbjudande']);
  assert.deepEqual(ut.tackning.map((t) => t.nyckel + ':' + t.lage), ['data:kunden_vet_inte']);
  assert.deepEqual(ut.research.map((r) => r.fraga), ['Hur tar cykelverkstäder i Umeå emot bokningar på nätet?']);
  assert.deepEqual(ut.avvisade.map((x) => x.orsak).sort(), ['citat_saknas_i_kundens_svar', 'domanen_kontrolleras_av_servern', 'fraga_till_kunden_inte_research'].sort());
});

test('Ett äldre uttalande i samtalet ändrar aldrig ett nyare val i kontrollerna', async () => {
  let a = await medSvar();
  a = (await A.sattTillval(a.id, { tillval: 'bokning', kundval: 'inte_nu', idempotens: 'KONTROLL01' })).a;
  gateway(agentUt({ tillval: [kundensBesked('bokning', 'onskat', 'Vi vill att kunderna ska kunna boka service själva.')] }));
  await A.nasta(a.id);
  const b = await A.lasArende(a.id);
  assert.equal(b.tillval.find((t) => t.id === 'bokning').kundval, 'inte_nu');
});

test('Tillval i kontroller: välja, ändra, ångra och eget behov; samma handling igen ger ingen ny rad', async () => {
  let a = await arende();
  let r = await A.sattTillval(a.id, { tillval: 'betalning', kundval: 'onskat', idempotens: 'TILLVAL01' });
  assert(r.ny);
  r = await A.sattTillval(a.id, { tillval: 'betalning', kundval: 'onskat', idempotens: 'TILLVAL01' });
  assert(!r.ny);
  r = await A.sattTillval(a.id, { tillval: 'betalning', kundval: 'onskat', idempotens: 'TILLVAL02' });
  assert(!r.ny, 'samma läge med ny nyckel (dubbelklick) ger ingen rad');
  await assert.rejects(A.sattTillval(a.id, { tillval: 'crm', kundval: 'har_system', idempotens: 'TILLVAL03' }), /vilket system/);
  await A.sattTillval(a.id, { tillval: 'crm', kundval: 'har_system', system: 'Fortnox', idempotens: 'TILLVAL04' });
  r = await A.sattTillval(a.id, { tillval: 'betalning', kundval: null, idempotens: 'TILLVAL05' });
  const annat = await A.sattTillval(a.id, { tillval: 'annat', kundval: 'onskat', beskrivning: 'Sälja presentkort', idempotens: 'TILLVAL06' });
  assert.equal(annat.tillval, 'annat_1');
  await assert.rejects(A.sattTillval(a.id, { tillval: 'crm', kundval: 'har_system', system: 'lösenord: hemligt123', idempotens: 'TILLVAL07' }), (e) => e.status === 422);
  a = await A.lasArende(a.id);
  const bet = a.tillval.find((t) => t.id === 'betalning');
  assert.equal(bet.kundval, null); assert.equal(bet.historik.length, 2);
  assert.equal(a.tillval.find((t) => t.id === 'crm').system, 'Fortnox');
  const vy = V.tillVy(a);
  assert.deepEqual(vy.uppdrag.valda.map((t) => t.id).sort(), ['annat_1', 'crm']);
  assert(vy.tillval.some((t) => t.id === 'annat_1' && t.namn === 'Sälja presentkort'));
});

test('Digitalas tillvalsstatus visas för kunden men ändrar inte kundrevisionen', async () => {
  let a = await arende();
  const rev = a.revision;
  a = await A.sattTillvalDigitala(a.id, { tillval: 'bokning', status: 'inkluderat', not: '', kalla: 'INTEGRATIONSVAL.json', utforare: 'digitala/prov', idempotens: 'DIGSTATUS1' });
  assert.equal(a.revision, rev);
  assert.equal(V.tillVy(a).tillval.find((t) => t.id === 'bokning').digitala_status, 'Ingår i det accepterade uppdraget');
});

test('Sent modellsvar kasseras när kunden rättar under väntan; kostnaden bokförs ändå', async () => {
  const a = await medSvar();
  gateway(agentUt({ uppgifter: [{ nyckel: 'erbjudande', rubrik: 'Verksamhet', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Vi är en cykelverkstad i Umeå.', kalla_id: 'AG1', sammanfattning: '' }] }), {
    fore: async () => { await A.registreraRattelse(a.id, { nyckel: 'erbjudande', varde: 'Cykelservice och uthyrning', idempotens: 'SENRATT01' }); },
  });
  const r = await A.nasta(a.id);
  assert(r.forkastad);
  const b = await A.lasArende(a.id);
  assert.equal(A.bild(b).find((x) => x.nyckel === 'erbjudande').varde, 'Cykelservice och uthyrning');
  assert.equal((b.uppgifter || []).length, 0); assert.equal(b.ai.kostnad_usd, 0.0028);
  assert.equal(b.ai.pagaende, null, 'låset släpps');
});

test('Två samtidiga turer ger ett modellanrop; den andra får vänta', async () => {
  const a = await medSvar();
  const anrop = gateway(agentUt(), { fore: () => vanta(80) });
  const [x, y] = await Promise.all([A.nasta(a.id), A.nasta(a.id)]);
  assert.equal(anrop.length, 1);
  const oppna = (await A.lasArende(a.id)).fragor.filter((f) => f.status === 'stalld');
  assert.equal(oppna.length, 1, 'en enda ny fråga');
  for (const r of [x, y]) assert(r.vantar || (r.fragor.length === 1 && r.fragor[0].id === oppna[0].id), 'den andra turen väntar eller får samma fråga');
});

test('Permanent HTTP-fel försöks inte om; avkortat svar får en ändlig större budget; transportfel gör det inte', async () => {
  let a = await medSvar();
  let anrop = gateway(agentUt(), { fel: [() => new Response('{}', { status: 403 })] });
  let r = await A.nasta(a.id);
  assert.equal(anrop.length, 1); assert(r.ai.fallback); assert.equal(r.fragor[0].valjare, 'regelstyrd');
  assert.equal((await A.lasArende(a.id)).ai.aktuell, 'reserv');
  a = await medSvar();
  anrop = gateway(agentUt(), { fel: [() => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{' } }], usage: { completion_tokens: 6000, cost: 0.012 } }))] });
  r = await A.nasta(a.id);
  assert.deepEqual(anrop.map((c) => c.body.max_completion_tokens), [6000, 10000]); assert(!r.ai.fallback);
  assert.equal((await A.lasArende(a.id)).ai.kostnad_usd, 0.0148, 'båda försökens faktiska kostnad bokförs');
  a = await medSvar();
  anrop = gateway(agentUt(), { fel: [() => { throw new TypeError('simulerat nätfel'); }] });
  r = await A.nasta(a.id);
  assert.deepEqual(anrop.map((c) => c.body.max_completion_tokens), [6000, 6000]);
});

test('Kostnadsspärr: ärendets tak stoppar före anrop; dygnstaket håller vid samtidiga reservationer', async () => {
  const a = await medSvar();
  process.env.KUNDSTART_AI_BUDGET_ARENDE_USD = '0.0001';
  try {
    const anrop = gateway(agentUt());
    const r = await A.nasta(a.id);
    assert.equal(anrop.length, 0, 'inget modellanrop när taket skulle passeras');
    assert.equal(r.fragor[0].valjare, 'regelstyrd');
    const b = await A.lasArende(a.id);
    assert.match(b.ai.budget_skal, /ärendets budget/); assert.equal(b.ai.aktuell, 'pausad');
    assert.match(V.tillVy(b).ai.beskrivning, /pausat \(ärendets budget/);
  } finally { delete process.env.KUNDSTART_AI_BUDGET_ARENDE_USD; }
  const idag = new Date().toISOString().slice(0, 10);
  const fore = (await B.budgetLage()).manad;
  const foreDygn = fore?.per_dygn?.[idag]?.usd || 0;
  const g = { arende_usd: 10, dygn_usd: foreDygn + 0.05, manad_usd: 1000 };
  const res = await Promise.all(Array.from({ length: 6 }, (_, i) => B.reservera('ar_samtidig' + i, 0, 0.02, g)));
  assert.equal(res.filter((x) => x.ok).length, 2, 'bara två reservationer om 0,02 ryms i 0,05');
  for (const x of res.filter((y) => y.ok)) await B.avrakna(x.id, 0.004, x.usd);
  const l = await B.budgetLage();
  assert.equal(l.manad.anrop - (fore?.anrop || 0), 2); assert(l.manad.forbrukat_usd - (fore?.forbrukat_usd || 0) >= 0.008 - 1e-9); assert(l.manad.vagrade - (fore?.vagrade || 0) >= 4);
  const okand = await B.reservera('ar_okand', 0, 0.01, { arende_usd: 10, dygn_usd: 1000, manad_usd: 1000 });
  assert(okand.ok);
  await B.avrakna(okand.id, null, okand.usd);
  assert((await B.budgetLage()).manad.okand_usd >= 0.01, 'okänd förbrukning bokförs som hela reservationen');
});

test('Domän: normalisering och kontroll som bara läser fasta värdar och aldrig följer omdirigeringar', async () => {
  assert.equal(D.normaliseraDoman('https://www.Testcykel.se/om?x=1'), 'testcykel.se');
  assert.equal(D.normaliseraDoman('cykel-ö.se'), 'xn--cykel--1xa.se');
  for (const fel of ['localhost', 'http://127.0.0.1', 'intern.local', 'a', 'x..se', 'foo.test']) assert.equal(D.normaliseraDoman(fel), null, fel);
  const varden = [];
  global.fetch = async (url, init) => {
    const u = new URL(String(url)); varden.push(u.host);
    assert.equal(init.redirect, 'manual');
    if (u.host === 'data.iana.org') return new Response(JSON.stringify({ services: [[['com'], ['https://rdap.verisign.com/com/v1/']]] }));
    if (u.host === 'rdap.verisign.com') return new Response(JSON.stringify({ entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Exempel Registrar AB']]] }] }));
    const typ = u.searchParams.get('type'); const namn = u.searchParams.get('name');
    const svar = { NS: [{ name: namn, type: 2, data: 'ns1.loopia.se.' }], MX: [{ name: namn, type: 15, data: '10 mailcluster.loopia.se.' }], A: [{ name: namn, type: 1, data: '93.184.216.34' }], CNAME: [] }[typ];
    return new Response(JSON.stringify({ Status: 0, Answer: svar }));
  };
  const k = await D.kontrolleraDoman('testcykel.com');
  assert.deepEqual([...new Set(varden)].sort(), ['cloudflare-dns.com', 'data.iana.org', 'rdap.verisign.com']);
  assert.equal(k.registrerad, true); assert.equal(k.kalla_registrering, 'rdap'); assert.equal(k.registrar, 'Exempel Registrar AB');
  assert.equal(k.dns_leverantor, 'Loopia'); assert.equal(k.epost.finns, true); assert.equal(k.webb.finns, true);
  assert.match(D.kontrollText(k), /registrerad via Exempel Registrar AB; DNS hanteras av Loopia/);
  global.fetch = async (url) => new URL(String(url)).host === 'data.iana.org' ? new Response(JSON.stringify({ services: [] })) : new Response(JSON.stringify({ Status: 3 }));
  const ledig = await D.kontrolleraDoman('ledigt-namn-123.se');
  assert.equal(ledig.registrerad, false); assert.equal(ledig.kalla_registrering, 'dns');
  global.fetch = async () => { throw new Error('nät nere'); };
  const nere = await D.kontrolleraDoman('testcykel.se');
  assert.equal(nere.registrerad, null); assert(nere.fel);
});

test('Domänflödet sparar val och kontroll i samma ärende och syns i översikten', async () => {
  global.fetch = async (url) => new URL(String(url)).host === 'data.iana.org' ? new Response(JSON.stringify({ services: [] })) : new Response(JSON.stringify({ Status: 0, Answer: [{ type: 2, data: 'ns1.loopia.se.' }] }));
  let a = await arende();
  const r = await A.sattDoman(a.id, { doman: 'www.testcykel.se', kundval: 'har_system', idempotens: 'DOMAN0001' });
  assert(r.ny);
  a = r.a;
  const t = a.tillval.find((x) => x.id === 'doman');
  assert.equal(t.system, 'testcykel.se'); assert.equal(t.kontroll.dns_leverantor, 'Loopia');
  const vy = V.tillVy(a).tillval.find((x) => x.id === 'doman');
  assert.equal(vy.kundval_text, 'Ni har redan en domän'); assert.match(vy.kontroll.text, /DNS hanteras av Loopia/);
  assert.equal(A.exportPaket(a).tillval.find((x) => x.id === 'doman').kontroll.doman, 'testcykel.se');
  await assert.rejects(A.sattDoman(a.id, { doman: 'localhost', kundval: 'har_system', idempotens: 'DOMAN0002' }), /dittforetag\.se/);
});

test('Rättelse i översikten vinner över agentens äldre tolkning och syns i samma ärende', async () => {
  const a = await medSvar();
  gateway(agentUt({ uppgifter: [{ nyckel: 'ton', rubrik: 'Ton', avsnitt: 'verksamhet', slag: 'tolkning', citat: 'Vi är en cykelverkstad i Umeå.', kalla_id: 'AG1', sammanfattning: 'Lokal och folklig' }] }));
  await A.nasta(a.id);
  let b = await A.lasArende(a.id);
  assert.equal(A.bild(b).find((x) => x.nyckel === 'ton').typ, 'ai');
  b = (await A.registreraRattelse(a.id, { nyckel: 'ton', varde: 'Saklig och kunnig', idempotens: 'TONRATT01' })).a;
  assert.equal(A.bild(b).find((x) => x.nyckel === 'ton').varde, 'Saklig och kunnig');
  assert.equal(b.uppgifter.find((u) => u.nyckel === 'ton').giltig, false);
  const direkt = (await A.registreraRattelse(a.id, { nyckel: 'verksamhetsmal', varde: 'Fler bokade servicetider', idempotens: 'MALRATT01' })).a;
  assert.equal(V.tillVy(direkt).uppdrag.mal[0].varde, 'Fler bokade servicetider', 'målet kan skrivas direkt i översikten');
});

test('Gatewaysvarets slutorsak, token och kostnad skiljs även vid fel', () => {
  for (const [reason, klass] of [['length', 'avkortat'], ['content_filter', 'vagran'], ['stop', 'format']]) {
    assert.throws(() => MO.lasGatewaySvar({ choices: [{ finish_reason: reason, message: { content: '{' } }], usage: { completion_tokens: 1500, cost: 0.003 } }), (e) => e.klass === klass && e.tokens_out === 1500 && e.kostnad_usd === 0.003);
  }
  const ok = MO.lasGatewaySvar({ choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 } });
  assert.deepEqual([ok.tokens_in, ok.tokens_out, ok.kostnad_usd], [10, 5, 0.0001]);
});

test('Ärende lagrat av den driftsatta versionen (133f37f) går att visa, exportera och fortsätta med agenten', async () => {
  // Fixturen är skapad med 133f37f:s lib/arende.ts (se fixturens "kalla"): bankfrågor, behovsfråga uppskjuten efter
  // "vet inte", öppen bankfråga, rättelse, inlämning och signal, men inga fält från den nya kandidaten.
  const fix = JSON.parse(fs.readFileSync(__dirname + '/fixtur-arende-133f37f.json', 'utf8')).arende;
  docs.set('arenden/' + fix.id + '.json', { body: JSON.stringify(fix), etag: '"fixtur"' });
  const id = fix.id;
  let a = await A.lasArende(id);
  const vy = V.tillVy(a);
  assert.deepEqual(vy.oppna.map((f) => f.id), ['BOK1']);
  assert(vy.uppdrag.senare.some((s) => s.id === 'BEH3_1'), 'uppskjuten behovsfråga kan tas upp igen');
  assert.equal(vy.overforing, 'vantar');
  assert(vy.uppdrag.forstatt.some((g) => g.rader.some((r) => r.nyckel === 'erbjudande' && r.varde.includes('däckbyte'))), 'rättelsen syns');
  let ex = A.exportPaket(a);
  assert.deepEqual([ex.kunduppgifter.length, ex.tillval.length, ex.research.length, ex.tackning_agent.length, ex.samtal_klar], [0, 0, 0, 0, null]);
  assert(ex.behov.some((b) => b.nyckel === 'paminnelser'));
  const signal1 = ex.signal.id;
  ({ a } = await A.registreraSvar(id, { fraga_id: 'BOK1', text: 'Service, däckbyte och vinterförvaring.', typ: 'text', idempotens: 'NYKOD0001' }));
  const anrop = gateway(agentUt({
    uppgifter: [
      { nyckel: 'erbjudande', rubrik: 'Verksamhet', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Vi är en cykelverkstad i Umeå.', kalla_id: 'A1', sammanfattning: '' },
      { nyckel: 'plats', rubrik: 'Plats', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Umeå', kalla_id: 'A1', sammanfattning: '' },
    ],
    tillval: [kundensBesked('bokning', 'onskat', 'Vi vill att kunderna ska kunna boka service själva', 'A1')],
  }));
  const r = await A.nasta(id);
  assert.equal(anrop.length, 1, 'agenten körs för det gamla ärendet');
  assert.equal(r.fragor.length, 1);
  assert.match(r.fragor[0].id, /^AG\d+$/);
  assert(!r.a.fragor.some((f, i, arr) => arr.findIndex((g) => g.id === f.id) !== i), 'inga dubbla fråge-id');
  ex = A.exportPaket(r.a);
  // Noteringen om erbjudandet citerar A1, som är äldre än kundens rättelse: rättelsen står kvar.
  assert.deepEqual(ex.kunduppgifter.map((u) => u.nyckel + ':' + u.kalla_id), ['plats:A1']);
  assert(A.bild(r.a).find((b) => b.nyckel === 'erbjudande').varde.includes('däckbyte'));
  const bokning = ex.tillval.find((t) => t.id === 'bokning');
  assert.equal(bokning.kundval, 'onskat'); assert.equal(bokning.kalla, 'samtal');
  assert.notEqual(ex.signal.id, signal1, 'svaret efter inlämningen ger en ny signal');
  a = await A.oppnaIgen(id, 'BEH3_1');
  assert(a.fragor.some((f) => f.id === 'BEH3_1' && f.status === 'stalld'));
  assert.equal(V.tillVy(a).overforing, 'andrat_efter');
});

(async () => {
  const result = [];
  for (const t of tests) {
    try { await t.fn(); result.push({ namn: t.name, ok: true }); console.log('PASS', t.name); }
    catch (e) { result.push({ namn: t.name, ok: false, fel: e.stack }); console.error('FAIL', t.name, e); }
  }
  const receipt = { tid: new Date().toISOString(), omfattning: 'Agent-, tillvals-, domän- och budgetkontrakt med kontrollerade ersättare för Blob, modell och DNS. Inte leverantörsprov.', resultat: result, complete: result.every((r) => r.ok) };
  if (process.env.KUNDSTART_PROVKVITTO_AGENT) fs.writeFileSync(process.env.KUNDSTART_PROVKVITTO_AGENT, JSON.stringify(receipt, null, 2));
  process.exit(receipt.complete ? 0 : 1);
})();
