/* eslint-disable @typescript-eslint/no-require-imports -- CJS-loadern ersätter endast provets transportmoduler. */
// Kontraktsprov för intervjuaren (turen och syntesen), tillvalen, domänkontrollen och kostnadsspärren. Blob, modell
// och DNS är kontrollerade transportdubblar i minnet; inga leverantörsanrop görs. Verkliga modellkörningar provas separat
// (tests/ai.spec.ts, scripts/modellprov.cjs).
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
// Proven prövar gateway-vägen, som bara anropas när servern uttryckligen startats med KUNDSTART_AI=gateway.
process.env.KUNDSTART_AI = 'gateway';
const A = require('../../lib/arende.ts'), AG = require('../../lib/agent.ts'), MO = require('../../lib/modell.ts'), B = require('../../lib/budget.ts'), D = require('../../lib/doman.ts'), T = require('../../lib/tackning.ts'), V = require('../../lib/vy.ts');
const { BANK } = require('../../lib/bank.ts');
const tests = []; const test = (name, fn) => tests.push({ name, fn });
const vanta = (ms) => new Promise((r) => setTimeout(r, ms));
async function arende(ai = 'gateway') { const { a } = await A.skapaArende({ kund: { slug: 'agentprov', namn: 'Agentprov TEST' }, testdialog: true, ai, fakta: [{ nyckel: 'erbjudande', varde: 'Cykelservice', status: 'kunden uppger', kalla: 'äldre underlag', omrade: 'A' }] }); return a; }
const SVAR1 = 'Vi är en cykelverkstad i Umeå. Vi vill att kunderna ska kunna boka service själva. Vi har domänen testcykel.se hos Loopia. Vi vet inte vad vi har för statistik.';
async function medSvar(ai = 'gateway') {
  let a = await arende(ai);
  a = (await A.borja(a.id)).a;
  assert.equal(a.fragor[0].id, 'AG1');
  return (await A.registreraSvar(a.id, { fraga_id: 'AG1', text: SVAR1, typ: 'text', idempotens: 'SVARAG1X' })).a;
}
function turUt(over = {}) {
  return { aterkoppling: 'Ni vill att kunderna bokar själva.', fraga: { text: 'Vilka tjänster ska kunna bokas?', nyckel: 'bokning_tjanster', behov_id: '', omrade: 'C', varfor: 'bokningens upplägg' }, tackning: [], klar: false, vagvisning: false, ...over };
}
function syntesUt(over = {}) {
  return { sammanfattning: 'Ni driver en cykelverkstad i Umeå och vill att kunderna ska kunna boka service själva.\n\nNi har domänen testcykel.se hos Loopia.', nyckelinsikt: 'Bokningen är kärnan i webbplatsen.', uppgifter: [], behov: [], tillval: [], tackning: [], research: [], oppet: [], ...over };
}
const kundensBesked = (tillval, kundval, citat, kalla_id = 'AG1', system = '') => ({ tillval, grund: 'kundens_besked', kundval, system, citat, kalla_id, motivering: '' });
const rekommendation = (tillval, motivering) => ({ tillval, grund: 'rekommendation', kundval: 'ingen', system: '', citat: '', kalla_id: '', motivering });
const turKontext = (a, over = {}) => AG.byggTurKontext(a, { kanda: [], tackning: [], farAvrunda: false, avrundaNu: false, viktigaKvar: 5, vagvisning: false, maxFragor: 14, ...over });
const syntesKontext = (a) => AG.byggSyntesKontext(a, { kanda: [], tackning: [], utlosta: [] });
/** Gatewaystubb: svarar med turens eller syntesens utdata beroende på vilket schema som begärs. */
function gateway(tur, syntes = syntesUt(), opts = {}) {
  const anrop = [];
  global.fetch = async (url, init) => {
    anrop.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    if (opts.fore) await opts.fore(anrop.length);
    if (opts.fel) {
      const f = Array.isArray(opts.fel) ? (anrop.length <= opts.fel.length ? opts.fel[anrop.length - 1] : null) : opts.fel(anrop.length);
      if (f) return f();
    }
    const namn = anrop[anrop.length - 1].body?.response_format?.json_schema?.name;
    const valt = namn === 'kundstart_syntes' ? syntes : tur;
    const u = typeof valt === 'function' ? valt(anrop.length) : valt;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(u) } }], usage: { prompt_tokens: 4000, completion_tokens: 900, cost: 0.0028 } }), { status: 200 });
  };
  return anrop;
}
const syntesAnrop = (anrop) => anrop.filter((k) => k.body?.response_format?.json_schema?.name === 'kundstart_syntes').length;
/** Kunden avslutar (intervjuaren avrundar med turstubben) och går vidare till granskningen (syntesstubben). */
async function tillGranskning(id) { await A.avsluta(id); return (await A.granska(id)).a; }
const UPPGIFT_ERBJUDANDE = { nyckel: 'erbjudande', rubrik: 'Verksamhet', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Vi är en cykelverkstad i Umeå.', kalla_id: 'AG1', sammanfattning: '', tacker: '' };

test('Öppningsfrågan är fast och ställs utan modellanrop när kunden börjar intervjun', async () => {
  const anrop = gateway(turUt());
  const a = await arende();
  assert.equal(A.fasAv(a), 'intro'); assert.equal((await A.nasta(a.id)).fragor.length, 0, 'i introfasen ställs ingen fråga');
  await A.borja(a.id);
  const r = await A.nasta(a.id);
  assert.equal(anrop.length, 0);
  assert.equal(r.fragor[0].id, 'AG1'); assert.equal(r.fragor[0].kalla, 'agent'); assert.equal(r.fragor[0].valjare, 'regelstyrd'); assert.equal(r.fragor[0].roll, 'oppning');
});

test('Turens schema är strikt och litet; en tur ger återkoppling, EN öppen fråga ur guiden och berörda nycklar', async () => {
  assert.equal(AG.TUR_SCHEMA.additionalProperties, false);
  assert.deepEqual([...AG.TUR_SCHEMA.required].sort(), ['aterkoppling', 'fraga', 'klar', 'tackning', 'vagvisning'].sort());
  assert(AG.TUR_SCHEMA.properties.fraga.properties.nyckel.enum.includes('avslut'));
  assert(!('alternativ' in AG.TUR_SCHEMA.properties.fraga.properties), 'inga flerval i intervjun');
  assert(AG.turSystemText().includes('INTERVJUGUIDE') && AG.turSystemText().includes('verksamhetsmal (prio 1)'), 'guiden kommer ur banken');
  assert.equal(AG.turSystemText(), AG.turSystemText(), 'statisk systemprompt');
  const a = await medSvar();
  const k = turKontext(a);
  assert.match(k.text, /^KUND: Agentprov TEST/); assert.match(k.text, /LÄGE: fråga 1 av högst 14 · avrundning tillåten: nej/); assert.match(k.text, /SENASTE SVAR: AG1 \|/);
  assert(!k.text.includes('TILLVALSKATALOG'), 'det statiska ligger i systemprompten, inte i turen');
  const ut = AG.valideraTur(turUt({ aterkoppling: '- Ni vill att kunderna bokar själva.', tackning: [{ nyckel: 'verksamhetsmal', lage: 'berord' }, { nyckel: 'verksamhetsmal', lage: 'tackt' }, { nyckel: 'hittepa', lage: 'tackt' }] }), k);
  assert(ut);
  assert.equal(ut.aterkoppling, 'Ni vill att kunderna bokar själva.', 'listmarkör strippas');
  const bf = BANK.foljdregler.flatMap((r) => r.fragor).find((f) => f.nyckel === 'bokning_tjanster');
  assert.equal(ut.fraga.nyckel, 'bokning_tjanster'); assert.equal(ut.fraga.omrade, bf.omrade, 'området kommer ur guiden, inte ur modellen');
  assert.deepEqual(ut.berorda, [{ nyckel: 'verksamhetsmal', lage: 'tackt' }], 'dubbletter slås ihop och okända nycklar faller bort');
  assert.equal(AG.valideraTur(turUt({ fraga: { ...turUt().fraga, nyckel: 'avslut' }, klar: true }), k), null, 'avrundning utan tillstånd förkastas');
  const avslut = AG.valideraTur(turUt({ fraga: { ...turUt().fraga, nyckel: 'avslut', text: 'Är det något mer ni vill ta upp?' }, klar: true }), turKontext(a, { farAvrunda: true }));
  assert(avslut && avslut.klar && avslut.fraga.nyckel === 'avslut');
  assert.equal(AG.valideraTur(turUt({ fraga: { ...turUt().fraga, nyckel: 'behov', behov_id: 'BEH9_9' } }), k), null, 'okänt behov förkastas');
  assert.equal(AG.valideraTur(turUt({ fraga: { ...turUt().fraga, nyckel: 'rymdfarkost' } }), k), null, 'nyckel utanför guiden förkastas');
  assert.equal(AG.valideraTur({ ...turUt(), klar: 'ja' }, k), null, 'fel form förkastas');
  // NEGATION speglas av servern: ett negerat följdämne som inte är utlöst får inte tas upp; frågan förkastas (standardlistan tar över).
  assert.equal(AG.valideraTur(turUt(), { ...k, negerade: new Set(['bokning']), utlosta: new Set() }), null);
  assert(AG.valideraTur(turUt(), { ...k, negerade: new Set(['bokning']), utlosta: new Set(['bokning']) }), 'utlöst vinner över negerat');
});

test('Syntesens schema är strikt; varje notering kräver ordagrant citat ur kundens svar eller material', async () => {
  assert.equal(AG.SYNTES_SCHEMA.additionalProperties, false);
  assert.deepEqual([...AG.SYNTES_SCHEMA.required].sort(), ['behov', 'nyckelinsikt', 'oppet', 'research', 'sammanfattning', 'tackning', 'tillval', 'uppgifter'].sort());
  const a = await medSvar();
  const k = syntesKontext(a);
  const ut = AG.valideraSyntes(syntesUt({
    sammanfattning: '# Så här förstod vi er\n- Ni är en cykelverkstad.',
    uppgifter: [UPPGIFT_ERBJUDANDE, { ...UPPGIFT_ERBJUDANDE, nyckel: 'hittepa', rubrik: 'Påhitt', citat: 'Vi har tre butiker.' }],
    tillval: [
      kundensBesked('bokning', 'onskat', 'Vi vill att kunderna ska kunna boka service själva.'),
      kundensBesked('rymdfarkost', 'onskat', 'Vi vill att kunderna ska kunna boka service själva.'),
      kundensBesked('crm', 'har_system', 'hos Loopia'),
      rekommendation('foretagsprofil', 'Lokala kunder söker på kartan.'),
    ],
    tackning: [{ nyckel: 'data', lage: 'kunden_vet_inte', citat: 'Vi vet inte vad vi har för statistik.', kalla_id: 'AG1' }],
    research: [{ fraga: 'Vad erbjuder konkurrenterna?', varfor: 'x', nyckel: '', citat: 'påhittat', kalla_id: 'kand' }],
    oppet: [{ nyckel: 'data', varfor: 'statistik saknas' }, { nyckel: 'data', varfor: 'dubblett' }, { nyckel: 'okand_nyckel', varfor: 'x' }],
  }), k);
  assert(ut);
  assert.equal(ut.sammanfattning, 'Så här förstod vi er\nNi är en cykelverkstad.', 'rubriker och listmarkörer strippas');
  assert.deepEqual(ut.uppgifter.map((u) => u.nyckel), ['erbjudande']);
  assert.equal(ut.uppgifter[0].status, 'kunden uppger'); assert.equal(ut.uppgifter[0].varde, 'Vi är en cykelverkstad i Umeå.');
  assert.deepEqual(ut.tillval_val.map((t) => t.tillval), ['bokning']);
  assert.equal(ut.tillval_rekommendation.length, 1); assert.equal(ut.tackning[0].lage, 'kunden_vet_inte');
  assert.equal(ut.research.length, 0);
  assert.deepEqual(ut.oppet, [{ nyckel: 'data', varfor: 'statistik saknas' }]);
  assert.deepEqual(ut.avvisade.map((x) => x.orsak).sort(), ['citat_saknas_i_kallan', 'okant_tillval', 'saknar_ordagrant_kallstod', 'system_saknas'].sort());
  assert.equal(AG.valideraSyntes(syntesUt({ sammanfattning: '' }), k), null, 'tom sammanfattning förkastas');
  assert.equal(AG.valideraSyntes({ ...syntesUt(), oppet: 'x' }, k), null, 'fel form förkastas');
});

test('En tur ger nästa fråga med återkoppling och berörda nycklar utan noteringar; syntesen tillämpar tillval, rekommendation, vet inte och research', async () => {
  const a = await medSvar();
  const anrop = gateway(turUt({ tackning: [{ nyckel: 'verksamhetsmal', lage: 'tackt' }] }), syntesUt({
    uppgifter: [UPPGIFT_ERBJUDANDE],
    tillval: [kundensBesked('bokning', 'onskat', 'Vi vill att kunderna ska kunna boka service själva.'), rekommendation('foretagsprofil', 'Lokala kunder söker på kartan.')],
    tackning: [{ nyckel: 'data', lage: 'kunden_vet_inte', citat: 'Vi vet inte vad vi har för statistik.', kalla_id: 'AG1' }],
    research: [{ fraga: 'Hur tar verkstäder i Umeå emot bokningar?', varfor: 'nivå', nyckel: '', citat: 'cykelverkstad i Umeå', kalla_id: 'AG1' }],
  }));
  const r = await A.nasta(a.id);
  assert.equal(anrop.length, 1); assert(anrop[0].url.endsWith('/v1/chat/completions'));
  assert.equal(anrop[0].body.response_format.json_schema.name, 'kundstart_tur'); assert.equal(anrop[0].body.response_format.json_schema.strict, true);
  assert.equal(anrop[0].body.max_completion_tokens, 2500, 'turen är liten');
  assert.equal(r.fragor[0].id, 'AG2'); assert.equal(r.fragor[0].valjare, 'ai'); assert.equal(r.fragor[0].inledning, 'Ni vill att kunderna bokar själva.');
  let b = await A.lasArende(a.id);
  assert.deepEqual(b.berorda.map((x) => x.nyckel + ':' + x.lage), ['verksamhetsmal:tackt']);
  assert.equal((b.tillval || []).length, 0, 'inga noteringar i turen'); assert.equal((b.uppgifter || []).length, 0);
  assert.equal(b.ai.kostnad_usd, 0.0028, 'gatewayens faktiska usage.cost bokförs');
  b = await tillGranskning(a.id);
  assert.equal(anrop.length, 3, 'avrundningstur + syntes'); assert.equal(syntesAnrop(anrop), 1);
  assert.equal(anrop[2].body.max_completion_tokens, 12000, 'syntesen får vara stor');
  assert.equal(A.fasAv(b), 'granskning'); assert.equal(b.syntes.status, 'klar'); assert.equal(b.syntes.valjare, 'ai'); assert.match(b.syntes.sammanfattning, /cykelverkstad/);
  assert.equal(b.samtal_klar.valjare, 'ai'); assert.equal(b.samtal_klar.meddelande, 'Ni vill att kunderna bokar själva.', 'avrundningens återkoppling blir avslutsmeddelandet');
  const bokning = b.tillval.find((t) => t.id === 'bokning');
  assert.equal(bokning.kundval, 'onskat'); assert.equal(bokning.kalla, 'samtal'); assert.equal(bokning.fraga_id, 'AG1');
  assert.equal(b.tillval.find((t) => t.id === 'foretagsprofil').kundval, null, 'rekommendation blir aldrig kundens val');
  assert.equal(T.tackning(b).find((t) => t.nyckel === 'data').status, 'kunden_vet_inte');
  assert.equal(b.research[0].status, 'bestalld');
  const vy = V.tillVy(b);
  assert(vy.uppdrag.valda.some((t) => t.id === 'bokning')); assert(vy.uppdrag.rekommenderade.some((t) => t.id === 'foretagsprofil')); assert.equal(vy.klar, true);
  const ex = A.exportPaket(b);
  assert.equal(ex.kunduppgifter[0].citat, 'Vi är en cykelverkstad i Umeå.'); assert.equal(ex.kunduppgifter[0].kalla_id, 'AG1');
  assert(ex.tillval.some((t) => t.id === 'bokning' && t.kundval === 'onskat')); assert.equal(ex.research.length, 1);
  assert.equal(ex.ai.pagaende, undefined, 'låset exporteras inte'); assert.equal(ex.syntes.valjare, 'ai'); assert.equal(ex.fas, 'granskning');
});

test('Kundens citat avgör tillvalet; domänresearch, frågor till kunden och "vi vet inte" som uppgift avvisas eller blir okänt', async () => {
  const a = await medSvar();
  const k = syntesKontext(a);
  const ut = AG.valideraSyntes(syntesUt({
    uppgifter: [{ ...UPPGIFT_ERBJUDANDE, nyckel: 'data', rubrik: 'Statistik', citat: 'Vi vet inte vad vi har för statistik.' }, UPPGIFT_ERBJUDANDE],
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

test('En uppgift med egen nyckel täcker guidens nyckel och hamnar under dess område', async () => {
  const a = await medSvar();
  const fore = T.tackning(a).find((t) => t.nyckel === 'erbjudande').status;
  gateway(turUt(), syntesUt({ uppgifter: [{ nyckel: 'service_utbud', rubrik: 'Service', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Vi är en cykelverkstad i Umeå.', kalla_id: 'AG1', sammanfattning: '', tacker: 'erbjudande' }] }));
  await A.nasta(a.id);
  const b = await tillGranskning(a.id);
  assert.equal(b.uppgifter.find((u) => u.nyckel === 'service_utbud').tacker, 'erbjudande');
  assert.notEqual(fore, 'uppgift_finns');
  assert.equal(T.tackning(b).find((t) => t.nyckel === 'erbjudande').status, 'uppgift_finns');
  const omrade = BANK.grund.find((g) => g.nyckel === 'erbjudande').omrade;
  assert.equal(A.bild(b).find((r) => r.nyckel === 'service_utbud').omrade, omrade, 'raden grupperas under erbjudandets område, inte Övrigt');
  assert.equal(A.exportPaket(b).kunduppgifter.find((u) => u.nyckel === 'service_utbud').tacker, 'erbjudande');
});

test('Räknaren för orörda viktiga områden gäller guiden, inte behov som kunden själv tagit upp; berörda nycklar räknas som täckta', async () => {
  const a = await medSvar();
  const fore = A.aterstar(a).viktiga;
  gateway(turUt({ tackning: [{ nyckel: 'besokare', lage: 'tackt' }] }), syntesUt({ behov: [{ nyckel: 'bokningsregler', citat: 'Vi vill att kunderna ska kunna boka service själva.', kalla_id: 'AG1', fraga: 'Vilka regler gäller för bokningen?' }] }));
  await A.nasta(a.id);
  let b = await A.lasArende(a.id);
  assert.equal(A.aterstar(b).viktiga, fore - 1, 'en nyckel som intervjuaren täckt i turen är inte orörd');
  assert.equal(T.tackning(b).find((x) => x.nyckel === 'besokare').status, 'inte_undersokt', 'exportens täckning är oförändrad');
  b = await tillGranskning(a.id);
  assert(b.behov.some((x) => x.nyckel === 'bokningsregler'));
  assert.equal(T.tackning(b).find((x) => x.nyckel === 'bokningsregler').status, 'inte_undersokt', 'exportens täckning är oförändrad');
  assert.equal(A.aterstar(b).viktiga, fore - 1, 'ett nämnt behov räknas inte som orört område');
  assert.equal(V.tillVy(b).uppdrag.aterstar.find((x) => x.nyckel === 'bokningsregler').status, 'namnt');
});

test('Ett äldre uttalande i samtalet ändrar aldrig ett nyare val i kontrollerna', async () => {
  let a = await medSvar();
  a = (await A.sattTillval(a.id, { tillval: 'bokning', kundval: 'inte_nu', idempotens: 'KONTROLL01' })).a;
  gateway(turUt(), syntesUt({ tillval: [kundensBesked('bokning', 'onskat', 'Vi vill att kunderna ska kunna boka service själva.')] }));
  await A.nasta(a.id);
  const b = await tillGranskning(a.id);
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
  gateway(turUt(), syntesUt(), { fore: async () => { await A.registreraRattelse(a.id, { nyckel: 'erbjudande', varde: 'Cykelservice och uthyrning', idempotens: 'SENRATT01' }); } });
  const r = await A.nasta(a.id);
  assert(r.forkastad);
  const b = await A.lasArende(a.id);
  assert.equal(A.bild(b).find((x) => x.nyckel === 'erbjudande').varde, 'Cykelservice och uthyrning');
  assert.equal(b.fragor.filter((f) => f.status === 'stalld').length, 0, 'ingen fråga ur det sena svaret'); assert.equal(b.ai.kostnad_usd, 0.0028);
  assert.equal(b.ai.pagaende, null, 'låset släpps');
});

test('Två samtidiga turer ger ett modellanrop; den andra får vänta', async () => {
  const a = await medSvar();
  const anrop = gateway(turUt(), syntesUt(), { fore: () => vanta(80) });
  const [x, y] = await Promise.all([A.nasta(a.id), A.nasta(a.id)]);
  assert.equal(anrop.length, 1);
  const oppna = (await A.lasArende(a.id)).fragor.filter((f) => f.status === 'stalld');
  assert.equal(oppna.length, 1, 'en enda ny fråga');
  for (const r of [x, y]) assert(r.vantar || (r.fragor.length === 1 && r.fragor[0].id === oppna[0].id), 'den andra turen väntar eller får samma fråga');
});

test('Permanent HTTP-fel försöks inte om; avkortat svar får en ändlig större budget; transportfel gör det inte', async () => {
  let a = await medSvar();
  let anrop = gateway(turUt(), syntesUt(), { fel: [() => new Response('{}', { status: 403 })] });
  let r = await A.nasta(a.id);
  assert.equal(anrop.length, 1); assert(r.ai.fallback); assert.equal(r.fragor[0].valjare, 'regelstyrd');
  assert.equal((await A.lasArende(a.id)).ai.aktuell, 'reserv');
  a = await medSvar();
  anrop = gateway(turUt(), syntesUt(), { fel: [() => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{' } }], usage: { completion_tokens: 2500, cost: 0.012 } }))] });
  r = await A.nasta(a.id);
  assert.deepEqual(anrop.map((c) => c.body.max_completion_tokens), [2500, 4000]); assert(!r.ai.fallback);
  assert.equal((await A.lasArende(a.id)).ai.kostnad_usd, 0.0148, 'båda försökens faktiska kostnad bokförs');
  a = await medSvar();
  anrop = gateway(turUt(), syntesUt(), { fel: [() => { throw new TypeError('simulerat nätfel'); }] });
  r = await A.nasta(a.id);
  assert.deepEqual(anrop.map((c) => c.body.max_completion_tokens), [2500, 2500]);
});

test('Syntesen: ett anrop åt gången, idempotent när den är aktuell, fel lämnar ärendet i avslut med svaren orörda, tredje felet ger reserv', async () => {
  // Fel vid syntesen: ärendet stannar i avslut, kunden kan försöka igen; efter tre fel sammanställs svaren deterministiskt.
  const a = await medSvar();
  let anrop = gateway(turUt(), syntesUt());
  await A.avsluta(a.id);
  assert.equal(A.fasAv(await A.lasArende(a.id)), 'avslut');
  anrop = gateway(turUt(), syntesUt(), { fel: () => () => new Response('{}', { status: 403 }) });
  let g = await A.granska(a.id);
  assert.equal(g.utford, false); assert.equal(g.fel, 'atkomst_eller_kontrakt');
  let b = await A.lasArende(a.id);
  assert.equal(A.fasAv(b), 'avslut'); assert.equal(b.syntes.status, 'misslyckad'); assert.equal(b.syntes.forsok, 1); assert.equal(b.svar.length, 1); assert.equal(b.ai.pagaende, null);
  g = await A.granska(a.id); assert.equal((await A.lasArende(a.id)).syntes.forsok, 2);
  g = await A.granska(a.id);
  assert.equal(g.utford, true); assert.equal(g.fallback, true);
  b = await A.lasArende(a.id);
  assert.equal(A.fasAv(b), 'granskning'); assert.equal(b.syntes.status, 'klar'); assert.equal(b.syntes.valjare, 'regelstyrd'); assert.equal(b.syntes.forsok, 3);
  assert(b.syntes.sammanfattning.includes('”' + SVAR1 + '”'), 'reserven är kundens egna ord ordagrant');
  assert.equal(syntesAnrop(anrop), 3, 'tre försök, sedan reserv utan fjärde');
  assert.equal((await A.granska(a.id)).utford, false); assert.equal(syntesAnrop(anrop), 3, 'reserven är aktuell: inget fjärde försök');
  // Lås och idempotens: två samtidiga granskningar ger ett syntesanrop; en aktuell sammanfattning skrivs inte om.
  const c = await medSvar();
  anrop = gateway(turUt(), syntesUt(), { fore: async (n) => { if (n >= 2) await vanta(80); } });
  await A.avsluta(c.id);
  const [x, y] = await Promise.all([A.granska(c.id), A.granska(c.id)]);
  assert.equal(syntesAnrop(anrop), 1, 'ett syntesanrop');
  assert(x.vantar || y.vantar || x.utford !== y.utford);
  let d = await A.lasArende(c.id);
  assert.equal(d.syntes.status, 'klar'); assert.equal(A.fasAv(d), 'granskning');
  const igen = await A.granska(c.id);
  assert.equal(igen.utford, false); assert.equal(igen.a.syntes.id, d.syntes.id); assert.equal(syntesAnrop(anrop), 1);
  // "Berätta mer" från granskningen: samtalet öppnas, sammanfattningen blir inaktuell och skrivs om med ny bas efter nästa avslut.
  const r = await A.nasta(c.id, { fortsatt: true });
  assert.equal(A.fasAv(r.a), 'intervju'); assert.equal(r.a.syntes.status, 'inaktuell'); assert.equal(r.fragor.length, 1); assert.notEqual(r.fragor[0].roll, 'avslut');
  await A.registreraSvar(c.id, { fraga_id: r.fragor[0].id, text: 'Vi har tre anställda.', typ: 'text', idempotens: 'FORTSATT01' });
  const e = await tillGranskning(c.id);
  assert.equal(e.syntes.status, 'klar'); assert(e.syntes.bas_revision > d.syntes.bas_revision); assert.notEqual(e.syntes.id, d.syntes.id);
  assert.equal(syntesAnrop(anrop), 2);
  assert.equal(V.tillVy(e).klar, true);
});

test('Kostnadsspärr: ärendets tak stoppar före anrop; dygnstaket håller vid samtidiga reservationer', async () => {
  const a = await medSvar();
  process.env.KUNDSTART_AI_BUDGET_ARENDE_USD = '0.0001';
  try {
    const anrop = gateway(turUt());
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

test('Rättelse i översikten vinner över intervjuarens äldre tolkning och syns i samma ärende', async () => {
  const a = await medSvar();
  gateway(turUt(), syntesUt({ uppgifter: [{ nyckel: 'ton', rubrik: 'Ton', avsnitt: 'verksamhet', slag: 'tolkning', citat: 'Vi är en cykelverkstad i Umeå.', kalla_id: 'AG1', sammanfattning: 'Lokal och folklig', tacker: '' }] }));
  await A.nasta(a.id);
  let b = await tillGranskning(a.id);
  assert.equal(A.bild(b).find((x) => x.nyckel === 'ton').typ, 'ai');
  b = (await A.registreraRattelse(a.id, { nyckel: 'ton', varde: 'Saklig och kunnig', idempotens: 'TONRATT01' })).a;
  assert.equal(A.bild(b).find((x) => x.nyckel === 'ton').varde, 'Saklig och kunnig');
  assert.equal(b.uppgifter.find((u) => u.nyckel === 'ton').giltig, false);
  assert(A.kundRevision(b) > b.syntes.bas_revision, 'sammanfattningen är inaktuell efter rättelsen');
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

test('Samtidig skrivning som Vercel Blob avvisar med 409 (conflicting operation) försöks om i stället för att ge 500', async () => {
  const a = await arende();
  const L = require('../../lib/lagring.ts');
  const put = blob.put; let kast = 0;
  blob.put = async (p, body, o) => {
    if (p.startsWith('arenden/') && o.ifMatch && kast < 2) { kast++; throw new Error('Vercel Blob: The conditional request cannot succeed due to a conflicting operation against this resource.'); }
    return put(p, body, o);
  };
  try {
    const r = await A.sattTillval(a.id, { tillval: 'bokning', kundval: 'onskat', idempotens: 'KONFLIKT409' });
    assert.equal(kast, 2); assert(r.ny);
    assert.equal((await A.lasArende(a.id)).tillval.find((t) => t.id === 'bokning').kundval, 'onskat');
    assert.equal(L.arSamtidigKonflikt(new Error('Vercel Blob: Access denied')), false, 'andra fel försöks inte om');
  } finally { blob.put = put; }
});

test('Granskningsnoter: låset släpps vid fel, markering skriver inte över kundens svar, domän igen ger ingen ny kontroll, reserverade nycklar vägras', async () => {
  // Låset: ett fel efter låset (här vägrar lagret budgetreskontran) lämnar inte ärendet låst i 80 s.
  let a = await medSvar();
  const put = blob.put;
  blob.put = async (p, body, o) => { if (p.startsWith('budget/')) throw new Error('Vercel Blob: lagret svarar inte'); return put(p, body, o); };
  gateway(turUt());
  try { await assert.rejects(A.nasta(a.id)); } finally { blob.put = put; }
  a = await A.lasArende(a.id);
  assert.equal(a.ai.pagaende, null, 'låset är släppt');
  assert(a.handelser.some((h) => h.typ === 'nasta_fel'));
  const anrop = gateway(turUt());
  const r = await A.nasta(a.id);
  assert.equal(anrop.length, 1, 'nästa tur körs direkt, utan att vänta ut låset'); assert.equal(r.fragor.length, 1);

  // Markering: kunden har själv svarat på AG1 (verksamhetsmal); en "vet inte"-markering på samma nyckel ur ett annat citat tillämpas inte.
  let b = await medSvar();
  gateway(turUt(), syntesUt({ tackning: [{ nyckel: 'verksamhetsmal', lage: 'kunden_vet_inte', citat: 'Vi vet inte vad vi har för statistik.', kalla_id: 'AG1' }] }));
  await A.nasta(b.id);
  b = await tillGranskning(b.id);
  assert.equal(T.tackning(b).find((t) => t.nyckel === 'verksamhetsmal').status, 'uppgift_finns');
  assert(!(b.tackning_agent || []).some((m) => m.nyckel === 'verksamhetsmal'));

  // Domän: samma domän och samma val igen med ny idempotensnyckel ger ingen ny kontroll och ingen ny historikrad.
  let c = await arende();
  let uppslag = 0;
  global.fetch = async (url) => { uppslag++; return new URL(String(url)).host === 'data.iana.org' ? new Response(JSON.stringify({ services: [] })) : new Response(JSON.stringify({ Status: 0, Answer: [{ type: 2, data: 'ns1.loopia.se.' }] })); };
  await A.sattDoman(c.id, { doman: 'testcykel.se', kundval: 'har_system', idempotens: 'DOMANDUB01' });
  const efterForsta = uppslag;
  const igen = await A.sattDoman(c.id, { doman: 'https://www.testcykel.se/', kundval: 'har_system', idempotens: 'DOMANDUB02' });
  assert.equal(igen.ny, false); assert.equal(uppslag, efterForsta, 'ingen ny DNS/RDAP-läsning');
  c = await A.lasArende(c.id);
  assert.equal(c.tillval.find((t) => t.id === 'doman').historik.length, 1);

  // Reserverade nycklar: intervjuaren kan inte lägga en uppgift under Digitalas egna faktanycklar.
  const d = await medSvar();
  const ut = AG.valideraSyntes(syntesUt({ uppgifter: [{ ...UPPGIFT_ERBJUDANDE, nyckel: 'tillval_bokning', rubrik: 'x' }, { ...UPPGIFT_ERBJUDANDE, nyckel: 'doman_kontroll', rubrik: 'x' }] }), syntesKontext(d));
  assert.equal(ut.uppgifter.length, 0);
  assert.deepEqual(ut.avvisade.map((x) => x.orsak), ['ogiltig_nyckel', 'ogiltig_nyckel']);
});

test('Omgång 2-noter: en misslyckad domänkontroll görs om, "Övrigt" står sist, reserverad nyckel redovisas som ogiltig', async () => {
  let c = await arende();
  global.fetch = async () => { throw new Error('nät nere'); };
  await A.sattDoman(c.id, { doman: 'testcykel.se', kundval: 'har_system', idempotens: 'DOMANFEL01' });
  c = await A.lasArende(c.id);
  assert(c.tillval.find((t) => t.id === 'doman').kontroll.fel, 'första kontrollen misslyckades');
  let uppslag = 0;
  global.fetch = async (url) => { uppslag++; return new URL(String(url)).host === 'data.iana.org' ? new Response(JSON.stringify({ services: [] })) : new Response(JSON.stringify({ Status: 0, Answer: [{ type: 2, data: 'ns1.loopia.se.' }] })); };
  const igen = await A.sattDoman(c.id, { doman: 'testcykel.se', kundval: 'har_system', idempotens: 'DOMANFEL02' });
  assert(uppslag > 0, 'samma domän efter en misslyckad kontroll läses om'); assert.equal(igen.ny, true);
  c = await A.lasArende(c.id);
  assert.equal(c.tillval.find((t) => t.id === 'doman').kontroll.fel, undefined);

  const b = await medSvar();
  gateway(turUt(), syntesUt({ uppgifter: [
    { ...UPPGIFT_ERBJUDANDE, nyckel: 'egen_sak', rubrik: 'Egen sak', citat: 'Vi har domänen testcykel.se hos Loopia.' },
    { ...UPPGIFT_ERBJUDANDE, nyckel: 'service_utbud', rubrik: 'Service', tacker: 'erbjudande' },
  ] }));
  await A.nasta(b.id);
  const grupper = V.tillVy(await tillGranskning(b.id)).uppdrag.forstatt.map((g) => g.namn);
  assert(grupper.length >= 2); assert.equal(grupper.at(-1), 'Övrigt', 'Övrigt sist: ' + grupper.join(', '));

  const d = await medSvar();
  const ut = AG.valideraSyntes(syntesUt({
    behov: [{ nyckel: 'tillval_bokning', citat: 'Vi vill att kunderna ska kunna boka service själva.', kalla_id: 'AG1', fraga: 'Vilka regler?' }],
    tackning: [{ nyckel: 'doman_kontroll', lage: 'kunden_vet_inte', citat: 'Vi vet inte vad vi har för statistik.', kalla_id: 'AG1' }],
  }), syntesKontext(d));
  assert.deepEqual(ut.avvisade.map((x) => x.verktyg + ':' + x.orsak), ['notera_behov:ogiltig_nyckel', 'markera_tackning:ogiltig_nyckel']);
});

test('Ärende lagrat av den driftsatta versionen (133f37f) går att visa, exportera och fortsätta med intervjuaren', async () => {
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
  assert.equal(A.fasAv(a), 'intervju');
  const anrop = gateway(turUt(), syntesUt({
    uppgifter: [{ ...UPPGIFT_ERBJUDANDE, kalla_id: 'A1' }, { nyckel: 'plats', rubrik: 'Plats', avsnitt: 'verksamhet', slag: 'kundens_ord', citat: 'Umeå', kalla_id: 'A1', sammanfattning: '', tacker: '' }],
    tillval: [kundensBesked('bokning', 'onskat', 'Vi vill att kunderna ska kunna boka service själva', 'A1')],
  }));
  const r = await A.nasta(id);
  assert.equal(anrop.length, 1, 'intervjuaren körs för det gamla ärendet');
  assert.equal(r.fragor.length, 1);
  assert.match(r.fragor[0].id, /^AG\d+$/);
  assert(!r.a.fragor.some((f, i, arr) => arr.findIndex((g) => g.id === f.id) !== i), 'inga dubbla fråge-id');
  const b = await tillGranskning(id);
  ex = A.exportPaket(b);
  // Noteringen om erbjudandet citerar A1, som är äldre än kundens rättelse: rättelsen står kvar.
  assert.deepEqual(ex.kunduppgifter.map((u) => u.nyckel + ':' + u.kalla_id), ['plats:A1']);
  assert(A.bild(b).find((x) => x.nyckel === 'erbjudande').varde.includes('däckbyte'));
  const bokning = ex.tillval.find((t) => t.id === 'bokning');
  assert.equal(bokning.kundval, 'onskat'); assert.equal(bokning.kalla, 'samtal');
  assert.notEqual(ex.signal.id, signal1, 'svaret efter inlämningen ger en ny signal');
  a = await A.oppnaIgen(id, 'BEH3_1');
  assert(a.fragor.some((f) => f.id === 'BEH3_1' && f.status === 'stalld'));
  assert.equal(V.tillVy(a).overforing, 'andrat_efter'); assert.equal(A.fasAv(a), 'intervju');
});

test('Utan uttryckligt KUNDSTART_AI anropas ingen gateway, inte heller för ett äldre gateway-ärende eller på Vercel', async () => {
  const a0 = await medSvar('gateway');
  const anrop = gateway(turUt());
  delete process.env.KUNDSTART_AI;
  try {
    const r = await A.nasta(a0.id);
    assert.equal(anrop.filter((x) => x.url.includes('ai-gateway')).length, 0, 'inget gateway-anrop');
    assert.equal(r.ai.lage, 'regelstyrd'); assert.equal(r.fragor.length, 1, 'standardlistan ställer nästa fråga');
    assert.equal(V.tillVy(r.a).ai.status, 'av'); assert.match(V.tillVy(r.a).ai.beskrivning, /AI-stöd: av/);
    assert.equal(A.effektivtLage('okant'), 'regelstyrd', 'ett okänt lagrat läge blir standardlistan');
    process.env.VERCEL = '1';
    assert.equal(A.aiLageStandard(), 'regelstyrd', 'nya ärenden på Vercel får standardlistan');
  } finally {
    process.env.KUNDSTART_AI = 'gateway'; delete process.env.VERCEL;
  }
});

test('Testlägets val: listorna, privat fil, syntesens eget val, oläsbar fil skrivs aldrig över, bara lokalt med claude-cli', async () => {
  const P = require('../../lib/provlage.ts');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kundstart-prov-'));
  const fore = process.env.KUNDSTART_PROV_DATA;
  process.env.KUNDSTART_PROV_DATA = path.join(dir, 'data');
  const fil = path.join(dir, 'data', 'installningar.json');
  try {
    assert.deepEqual(P.lasProv(), { modell: 'claude-opus-5-5', anstrangning: 'low' }, 'standardvalet utan fil');
    assert.deepEqual(P.lasSyntesProv(), { modell: 'claude-opus-5-5', anstrangning: 'medium' }, 'syntesens standardval utan fil');
    assert.deepEqual(P.sparaProv('claude-sonnet-5', 'high'), { modell: 'claude-sonnet-5', anstrangning: 'high' });
    assert.equal(fs.statSync(fil).mode & 0o777, 0o600); assert.equal(fs.statSync(path.join(dir, 'data')).mode & 0o777, 0o700);
    assert.deepEqual(P.lasSyntesProv(), { modell: 'claude-opus-5-5', anstrangning: 'medium' }, 'turens val rör inte syntesens');
    P.sparaProv('claude-sonnet-5', 'high', { modell: 'claude-haiku-4-5-20251001', anstrangning: 'low' });
    assert.deepEqual(P.lasSyntesProv(), { modell: 'claude-haiku-4-5-20251001', anstrangning: 'low' });
    assert.equal(P.provVy().syntes.namn, 'Haiku 4.5');
    assert.throws(() => P.sparaProv('claude-sonnet-5', 'high', { modell: 'openai/gpt-5-mini', anstrangning: 'low' }), /okänd modell/);
    assert.throws(() => P.sparaProv('openai/gpt-5-mini', 'high'), /okänd modell/);
    assert.throws(() => P.sparaProv('claude-sonnet-5', 'turbo'), /okänd ansträngning/);
    fs.writeFileSync(fil, JSON.stringify({ modell: 'claude-haiku-4-5-20251001', anstrangning: 'max', egen: 'behålls' }));
    P.sparaProv('claude-opus-5', 'medium');
    assert.equal(JSON.parse(fs.readFileSync(fil, 'utf8')).egen, 'behålls', 'övriga nycklar lämnas orörda');
    fs.writeFileSync(fil, '{trasig');
    assert.throws(() => P.sparaProv('claude-opus-5', 'low'), /går inte att läsa/);
    assert.equal(fs.readFileSync(fil, 'utf8'), '{trasig', 'en oläsbar fil skrivs aldrig över');
    assert.deepEqual(P.lasProv(), { modell: 'claude-opus-5-5', anstrangning: 'low' }, 'oläsbar fil ger standardvalet');
    assert.equal(P.turTimeoutMs('low'), 170000); assert.equal(P.turTimeoutMs('max'), 300000); assert.equal(P.syntesTimeoutMs(), 300000);
    fs.rmSync(fil);
    process.env.KUNDSTART_AI = 'claude-cli';
    assert.equal(P.provTillatet(), true);
    assert.equal(A.effektivtLage('claude-cli'), 'claude-cli'); assert.equal(A.effektivtLage('gateway'), 'regelstyrd');
    P.sparaProv('claude-sonnet-5', 'medium');
    const vy = V.tillVy(await arende('claude-cli'));
    assert.equal(vy.ai.prov.namn, 'Sonnet 5'); assert.equal(vy.ai.prov.anstrangning, 'medium');
    assert.match(vy.ai.beskrivning, /lokalt testläge med Claude \(Sonnet 5 · medium\)/);
    process.env.VERCEL = '1';
    assert.equal(P.provTillatet(), false, 'aldrig på Vercel'); assert.equal(A.effektivtLage('claude-cli'), 'regelstyrd');
    assert.equal(V.tillVy(await arende('claude-cli')).ai.prov, undefined, 'ingen modellväljare utanför testläget');
  } finally {
    process.env.KUNDSTART_AI = 'gateway'; delete process.env.VERCEL;
    if (fore === undefined) delete process.env.KUNDSTART_PROV_DATA; else process.env.KUNDSTART_PROV_DATA = fore;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Kvotbesked från claude -p klassas per modell, utan råtext; vägran och inloggning skiljs från transport', () => {
  const k1 = MO.tolkaCliFel(1, '', "You've hit your session limit · resets 14:00\n", 'claude-opus-5-5');
  assert.equal(k1.klass, 'kvot'); assert.equal(k1.diagnos.modell, 'claude-opus-5-5'); assert.equal(k1.diagnos.aterstalls, '14:00'); assert.equal(k1.retry, false);
  const k2 = MO.tolkaCliFel(1, JSON.stringify({ is_error: true, result: "You've reached your Opus limit. Switch to another model or wait until it resets." }), '', 'claude-opus-5-5', 'format');
  assert.equal(k2.klass, 'kvot'); assert.equal(k2.diagnos.modell, 'Opus'); assert.equal(k2.diagnos.aterstalls, undefined);
  assert(k2.diagnos.besked.length <= 120 && !k2.diagnos.besked.includes('wait until'), 'bara det matchade beskedet följer med');
  const k3 = MO.tolkaCliFel(1, '', "You've reached your Opus 5.5 usage limit · resets 9pm", 'claude-opus-5-5');
  assert.equal(k3.diagnos.modell, 'Opus 5.5');
  assert.equal(MO.tolkaCliFel(1, '', 'Not logged in · Please run /login', 'x').klass, 'atkomst');
  assert.equal(MO.tolkaCliFel(1, JSON.stringify({ is_error: true, result: 'The request was refused by the safety classifier.' }), '', 'x', 'format').klass, 'vagran');
  const t = MO.tolkaCliFel(137, 'inte json', 'Killed', 'x');
  assert.equal(t.klass, 'transport'); assert.equal(t.diagnos.rc, 137); assert.equal(t.diagnos.besked, undefined, 'ingen råtext');
  assert.equal(MO.tolkaCliFel(0, JSON.stringify({ is_error: true, result: 'okänt' }), '', 'x', 'format').klass, 'format');
});

test('claude -p i testläget: bara modell och ansträngning ur listorna som flaggor, inga nycklar i barnprocessens miljö; kvoten stoppar inte intervjun', async () => {
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kundstart-cli-'));
  const ut = path.join(dir, 'ut');
  // Ett låtsat claude-kommando först i PATH: skriver ned argument och miljö och svarar som claude -p --output-format json,
  // med turens eller syntesens form beroende på schemat; med PROV_KVOT satt avslutas det som när kvoten är slut.
  const binar = path.join(dir, 'claude');
  fs.writeFileSync(binar, [
    '#!/bin/sh',
    'for a in "$@"; do printf \'%s\\n\' "$a"; done > "$PROV_UT.args"',
    'env > "$PROV_UT.env"',
    'cat > /dev/null',
    'if [ -n "$PROV_KVOT" ]; then printf \'%s\\n\' "You\'ve reached your Opus limit. Switch to another model…" >&2; exit 1; fi',
    'if grep -q sammanfattning "$PROV_UT.args"; then printf \'{"structured_output":{"sammanfattning":"Ni driver en cykelverkstad.","nyckelinsikt":"Bokning.","uppgifter":[],"behov":[],"tillval":[],"tackning":[],"research":[],"oppet":[]},"usage":{"input_tokens":3,"output_tokens":2,"cache_read_input_tokens":40,"cache_creation_input_tokens":0},"total_cost_usd":0.01}\'; exit 0; fi',
    'printf \'{"structured_output":{"aterkoppling":"Ni vill boka.","fraga":{"text":"Vilka tjänster?","nyckel":"bokning_tjanster","behov_id":"","omrade":"C","varfor":"x"},"tackning":[],"klar":false,"vagvisning":false},"usage":{"input_tokens":3,"output_tokens":2,"cache_read_input_tokens":40,"cache_creation_input_tokens":0},"total_cost_usd":0.01}\'',
  ].join('\n') + '\n', { mode: 0o755 });
  const nycklar = { ANTHROPIC_API_KEY: 'provnyckel-anthropic', BLOB_READ_WRITE_TOKEN: 'provnyckel-blob', VERCEL_OIDC_TOKEN: 'provnyckel-oidc' };
  const fore = { PATH: process.env.PATH, KUNDSTART_PROV_DATA: process.env.KUNDSTART_PROV_DATA, ...Object.fromEntries(Object.keys(nycklar).map((k) => [k, process.env[k]])) };
  process.env.PATH = dir + ':' + process.env.PATH; process.env.PROV_UT = ut; Object.assign(process.env, nycklar);
  process.env.KUNDSTART_PROV_DATA = path.join(dir, 'data');
  const begaran = { modell: 'claude-sonnet-5', system: 'Systemprompt på en rad.', anvandare: 'hej', schemaNamn: 's', schema: { type: 'object' }, maxTokens: 100, timeoutMs: 5000 };
  try {
    const r = await MO.viaClaudeCli({ ...begaran, anstrangning: 'turbo --dangerously-skip-permissions' });
    assert.equal(r.rå.aterkoppling, 'Ni vill boka.'); assert.equal(r.kostnad_usd, null, 'kvot, inte kostnad'); assert.equal(r.diagnos.cache_read, 40);
    const args = fs.readFileSync(ut + '.args', 'utf8').split('\n');
    assert.equal(args[args.indexOf('--effort') + 1], 'low', 'okänd ansträngning blir low');
    assert.equal(args[args.indexOf('--model') + 1], 'claude-sonnet-5');
    assert(!args.some((x) => x.includes('dangerously')), 'inga egna flaggor når claude');
    const env = fs.readFileSync(ut + '.env', 'utf8');
    assert.match(env, /^PROV_UT=/m, 'miljön skrevs ned');
    for (const namn of ['ANTHROPIC_API_KEY', 'AI_GATEWAY_API_KEY', 'KUNDSTART_AI', 'BLOB_READ_WRITE_TOKEN', 'VERCEL_OIDC_TOKEN']) {
      assert(process.env[namn], namn + ' är satt i provet'); assert(!new RegExp('^' + namn + '=', 'm').test(env), namn + ' ärvs inte');
    }
    assert.match(env, /^CLAUDE_CODE_DISABLE_AUTO_MEMORY=1$/m);
    await MO.viaClaudeCli({ ...begaran, modell: 'openai/gpt-5-mini', anstrangning: 'max' });
    const args2 = fs.readFileSync(ut + '.args', 'utf8').split('\n');
    assert.equal(args2.indexOf('--model'), -1, 'en gateway-modell skickas aldrig till claude'); assert.equal(args2[args2.indexOf('--effort') + 1], 'max');
    // Hela flödet i testläget: tur, kundens avslut (intervjuaren avrundar) och syntes via claude -p, med syntesens eget val.
    process.env.KUNDSTART_AI = 'claude-cli';
    require('../../lib/provlage.ts').sparaProv('claude-sonnet-5', 'low', { modell: 'claude-opus-5-5', anstrangning: 'high' });
    const a = await medSvar('claude-cli');
    const tur = await A.nasta(a.id);
    assert.equal(tur.ai.lage, 'claude-cli'); assert.equal(tur.fragor[0].inledning, 'Ni vill boka.'); assert.equal(tur.ai.modell, 'claude-sonnet-5');
    assert.equal(fs.readFileSync(ut + '.args', 'utf8').split('\n').at(-2), 'low');
    const b = await tillGranskning(a.id);
    assert.equal(A.fasAv(b), 'granskning'); assert.equal(b.syntes.valjare, 'ai'); assert.equal(b.syntes.modell, 'claude-opus-5-5'); assert.equal(b.syntes.anstrangning, 'high');
    assert.equal(b.syntes.sammanfattning, 'Ni driver en cykelverkstad.');
    assert.equal(b.ai.diagnostik.at(-1).cache_read, 40, 'cacheträffar bokförs');
    // Kvoten slut: turen faller till standardlistan utan paus, med modellen i beskedet; nästa lyckade anrop nollställer.
    process.env.PROV_KVOT = '1';
    const c = await medSvar('claude-cli');
    const r2 = await A.nasta(c.id);
    assert(r2.ai.fallback); assert.equal(r2.ai.fel, 'kvot'); assert.equal(r2.fragor[0].valjare, 'regelstyrd');
    let d = await A.lasArende(c.id);
    assert.equal(d.ai.kvot.modell, 'Opus'); assert.equal(d.ai.paus_till, undefined, 'ingen paus: botemedlet är att byta modell'); assert(!d.ai.fel_i_rad);
    delete process.env.PROV_KVOT;
    await A.registreraSvar(c.id, { fraga_id: r2.fragor[0].id, text: 'Mest privatpersoner.', typ: 'text', idempotens: 'KVOTSVAR01' });
    await A.nasta(c.id);
    d = await A.lasArende(c.id);
    assert.equal(d.ai.kvot, null, 'ett lyckat anrop nollställer kvotbeskedet');
  } finally {
    delete process.env.PROV_UT; delete process.env.PROV_KVOT; process.env.KUNDSTART_AI = 'gateway';
    for (const [k, v] of Object.entries(fore)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

(async () => {
  const result = [];
  for (const t of tests) {
    try { await t.fn(); result.push({ namn: t.name, ok: true }); console.log('PASS', t.name); }
    catch (e) { result.push({ namn: t.name, ok: false, fel: e.stack }); console.error('FAIL', t.name, e); }
  }
  const receipt = { tid: new Date().toISOString(), omfattning: 'Intervjuarens tur- och synteskontrakt, tillvals-, domän- och budgetkontrakt med kontrollerade ersättare för Blob, modell och DNS. Inte leverantörsprov.', resultat: result, complete: result.every((r) => r.ok) };
  if (process.env.KUNDSTART_PROVKVITTO_AGENT) fs.writeFileSync(process.env.KUNDSTART_PROVKVITTO_AGENT, JSON.stringify(receipt, null, 2));
  process.exit(receipt.complete ? 0 : 1);
})();
