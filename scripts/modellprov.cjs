#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CJS-loadern laddar bara projektets egna TypeScript-moduler. */
// Promptprov utan webbläsare: bygger turens och syntesens prompter ur fixturärendet och kör claude -p en gång vardera
// på ägarens egen inloggning (bara ägarens egna prov; aldrig på Vercel, aldrig för kunder). Skriver tid, cache-fält,
// token, validerad utdata och avvisade noteringar, så att prompterna kan itereras mot riktig modell.
//
//   node scripts/modellprov.cjs [--model claude-opus-5-5] [--effort low] [--bara tur|syntes]
//
// Förbrukningen räknas i abonnemangets kvot (en modellsession per anrop); listpriset skrivs bara som diagnos.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
// Lagret behövs inte (fixturen läses från fil); @vercel/blob ersätts med en tom modul.
const originalLoad = Module._load; Module._load = function (id, ...args) { return id === '@vercel/blob' ? { BlobPreconditionFailedError: class extends Error {} } : originalLoad.call(this, id, ...args); };
if (process.env.VERCEL) { console.error('modellprov körs bara lokalt'); process.exit(2); }
delete process.env.KUNDSTART_AI;

const AG = require('../lib/agent.ts'), MO = require('../lib/modell.ts'), A = require('../lib/arende.ts'), T = require('../lib/tackning.ts');
const arg = (namn, standard) => { const i = process.argv.indexOf(namn); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : standard; };
const modell = arg('--model', 'claude-opus-5-5');
const effort = arg('--effort', 'low');
const bara = arg('--bara', '');
const fix = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/core/fixtur-arende-133f37f.json'), 'utf8')).arende;
const kanda = A.bild(fix).map((b) => ({ nyckel: b.nyckel, varde: b.varde, status: b.status, kalla: b.typ === 'kund' ? 'kunden' : b.typ === 'ai' ? 'vår tolkning' : b.kalla }));
const tackning = T.tackning(fix).map((x) => ({ nyckel: x.nyckel, status: x.status, fraga: x.fraga, prio: x.prio }));
const kb = (s) => `${Buffer.byteLength(s, 'utf8')} byte`;

async function kor(slag, system, anvandare, schema, maxTokens, validera) {
  console.log(`\n== ${slag} == modell ${modell} · ansträngning ${effort} · systemprompt ${kb(system)} · meddelande ${kb(anvandare)}`);
  const start = Date.now();
  try {
    const r = await MO.viaClaudeCli({ modell, system, anvandare, schemaNamn: 'kundstart_' + slag, schema, maxTokens, timeoutMs: 300_000, anstrangning: effort });
    const ut = validera(r.rå);
    console.log(`tid ${Date.now() - start} ms · tokens in ${r.tokens_in} ut ${r.tokens_out} · cache_read ${r.diagnos.cache_read} cache_write ${r.diagnos.cache_write} · listpris (ej kostnad) ${r.diagnos.listpris_usd_ej_kostnad}`);
    console.log(ut ? JSON.stringify(ut, null, 2) : 'VALIDERING: svaret gick inte att använda\n' + JSON.stringify(r.rå, null, 2));
    return ut;
  } catch (e) {
    console.log(`FEL efter ${Date.now() - start} ms: ${e.klass || e.message}`, e.diagnos || '');
    return null;
  }
}

(async () => {
  if (bara !== 'syntes') {
    const k = AG.byggTurKontext(fix, { kanda: kanda.filter((x) => !x.kalla.startsWith('kundens svar')), tackning, farAvrunda: A.farAvrunda(fix), avrundaNu: false, viktigaKvar: A.aterstar(fix).viktiga, vagvisning: false, maxFragor: A.AVSLUT_EFTER_FRAGOR });
    await kor('tur', AG.turSystemText(), k.text, AG.TUR_SCHEMA, 2500, (rå) => AG.valideraTur(rå, k));
  }
  if (bara !== 'tur') {
    const k = AG.byggSyntesKontext(fix, { kanda, tackning, utlosta: fix.foljdregler_utlosta.map((u) => `${u.regel} (${u.fraga_id}: "${u.traff}")`) });
    const ut = await kor('syntes', AG.syntesSystemText(), k.text, AG.SYNTES_SCHEMA, 12000, (rå) => AG.valideraSyntes(rå, k));
    if (ut) console.log(`avvisade noteringar: ${ut.avvisade.length}`);
  }
})();
