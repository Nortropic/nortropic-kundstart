#!/usr/bin/env node
// Kundstarts lokala testläge, som förbättringspartnern: servern körs på den egna datorn (127.0.0.1:3131) och varje
// AI-tur går med Claude Code på ägarens inloggning. Bara för ägarens egna prov, aldrig för kunder: Anthropics villkor
// tillåter inte att en Pro- eller Max-inloggning svarar någon annans användare.
//
//   npm run prov -- start     bygg om vid behov och starta servern i bakgrunden
//   npm run prov -- oppna     öppna ägarens provärende i webbläsaren (--ny skapar ett nytt provärende)
//   npm run prov -- status    visa om servern kör, vilken kod och vilket modellval
//   npm run prov -- stopp     stoppa servern
//
// Kör från primärutcheckningen på main och starta om efter varje sammanfogning (stopp, start), som partnern.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 3131;
const BAS = `http://127.0.0.1:${PORT}`;
const DATA = process.env.KUNDSTART_PROV_DATA || join(homedir(), '.nortropic-kundstart-prov');
const LANKFIL = join(homedir(), '.nortropic-hemligheter', 'kundstart', 'LOKAL-PROVLANK.secret');
const PIDFIL = join(DATA, 'tjanst.pid');
const LOGG = join(DATA, 'tjanst.log');
const BYGGD = join(DATA, 'byggd.json');

const git = (...a) => spawnSync('git', ['-C', ROT, ...a], { encoding: 'utf8' }).stdout.trim();
const vila = (ms) => new Promise((r) => setTimeout(r, ms));

function privatKatalog() {
  mkdirSync(DATA, { recursive: true, mode: 0o700 });
  chmodSync(DATA, 0o700);
}

function pid() {
  try {
    const p = Number(readFileSync(PIDFIL, 'utf8').trim());
    process.kill(p, 0);
    return p;
  } catch {
    return null;
  }
}

async function svarar() {
  try {
    const r = await fetch(BAS + '/', { signal: AbortSignal.timeout(3000) });
    return r.status;
  } catch {
    return 0;
  }
}

function envLokal() {
  const ut = {};
  try {
    for (const rad of readFileSync(join(ROT, '.env.local'), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(rad.trim());
      if (m) ut[m[1]] = m[2];
    }
  } catch {
    /* saknas: servern säger själv vad som fattas */
  }
  return ut;
}

function modellval() {
  try {
    const d = JSON.parse(readFileSync(join(DATA, 'installningar.json'), 'utf8'));
    return `${d.modell || 'claude-opus-5-5'} · ${d.anstrangning || 'low'}`;
  } catch {
    return 'claude-opus-5-5 · low (standard)';
  }
}

async function start() {
  const p = pid();
  if (p && (await svarar())) return console.log(`Testläget kör redan på ${BAS} (pid ${p}).`);
  if (await svarar()) {
    console.error(`Port ${PORT} används av en annan process. Stoppa den först (lsof -nP -iTCP:${PORT} -sTCP:LISTEN).`);
    return 1;
  }
  privatKatalog();
  const head = git('rev-parse', 'HEAD');
  const smutsig = git('status', '--porcelain') !== '';
  let byggd = {};
  try { byggd = JSON.parse(readFileSync(BYGGD, 'utf8')); } catch { /* första gången */ }
  if (!existsSync(join(ROT, '.next', 'BUILD_ID')) || byggd.head !== head || smutsig || byggd.smutsig) {
    console.log(`Bygger ${head.slice(0, 7)}${smutsig ? ' med ocommittade ändringar' : ''} …`);
    const b = spawnSync('npm', ['run', '-s', 'build'], { cwd: ROT, stdio: 'inherit', env: { ...process.env, KUNDSTART_AI: 'claude-cli' } });
    if (b.status !== 0) return console.error('Bygget misslyckades; servern startades inte.'), 1;
    writeFileSync(BYGGD, JSON.stringify({ head, smutsig, tid: new Date().toISOString() }) + '\n', { mode: 0o600 });
  }
  const fd = openSync(LOGG, 'a', 0o600);
  chmodSync(LOGG, 0o600);
  const barn = spawn(process.execPath, [join(ROT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '127.0.0.1', '-p', String(PORT)], {
    cwd: ROT, detached: true, stdio: ['ignore', fd, fd],
    env: { ...process.env, KUNDSTART_AI: 'claude-cli', KUNDSTART_PROV_DATA: DATA, NODE_ENV: 'production' },
  });
  closeSync(fd);
  writeFileSync(PIDFIL, String(barn.pid) + '\n', { mode: 0o600 });
  barn.unref();
  for (let i = 0; i < 120; i++) {
    await vila(500);
    if ((await svarar()) === 200) {
      console.log(`Testläget kör på ${BAS} (pid ${barn.pid}), kod ${head.slice(0, 7)}, modell ${modellval()}.`);
      return console.log('Öppna med: npm run prov -- oppna');
    }
  }
  console.error(`Servern svarade inte inom 60 s; se ${LOGG}.`);
  return 1;
}

async function stopp() {
  const p = pid();
  if (!p) return console.log('Testläget kör inte.');
  process.kill(p, 'SIGTERM');
  for (let i = 0; i < 40; i++) {
    await vila(250);
    try { process.kill(p, 0); } catch { return console.log('Testläget är stoppat.'); }
  }
  process.kill(p, 'SIGKILL');
  console.log('Testläget stoppades (efter 10 s med SIGKILL).');
}

async function status() {
  const p = pid();
  const s = await svarar();
  const head = git('rev-parse', '--short', 'HEAD');
  const main = git('rev-parse', '--short', 'origin/main');
  let byggd = {};
  try { byggd = JSON.parse(readFileSync(BYGGD, 'utf8')); } catch { /* inte byggt av prov.mjs */ }
  console.log(`Testläge: ${p && s ? `kör (pid ${p})` : s ? `port ${PORT} används av en annan process` : 'kör inte'}`);
  console.log(`Adress:   ${BAS}`);
  console.log(`Kod:      ${head} i ${ROT} (${head === main ? 'samma som origin/main' : 'origin/main är ' + main})` + (byggd.head ? `, byggd från ${String(byggd.head).slice(0, 7)}` : ''));
  console.log(`Modell:   ${modellval()} genom Claude Code på din inloggning`);
  console.log(`Data:     ${DATA}`);
  return p && s ? 0 : 3;
}

async function oppna(ny) {
  if (!pid() || (await svarar()) !== 200) return console.error('Testläget kör inte; starta med: npm run prov -- start'), 3;
  let lank = '';
  try { lank = readFileSync(LANKFIL, 'utf8').trim(); } catch { /* ingen sparad länk */ }
  if (ny || !lank.startsWith(BAS + '/start#')) {
    const nyckel = process.env.KUNDSTART_INTERN_NYCKEL || envLokal().KUNDSTART_INTERN_NYCKEL;
    if (!nyckel) return console.error('KUNDSTART_INTERN_NYCKEL saknas i .env.local; kan inte skapa ett provärende.'), 1;
    const r = await fetch(BAS + '/api/intern/arenden', {
      method: 'POST', headers: { Authorization: 'Bearer ' + nyckel, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kund: { slug: 'agarens-prov', namn: 'Ägarens prov' }, testdialog: true, kanal: 'Kundstart-länk (TESTDIALOG, lokalt testläge)', bas_url: BAS, ai: 'claude-cli', fakta: [] }),
    });
    if (r.status !== 201) return console.error(`Kunde inte skapa ett provärende (HTTP ${r.status}).`), 1;
    lank = (await r.json()).lank;
    mkdirSync(dirname(LANKFIL), { recursive: true, mode: 0o700 });
    writeFileSync(LANKFIL, lank + '\n', { mode: 0o600 });
    chmodSync(LANKFIL, 0o600);
    console.log('Skapade ett nytt provärende (TESTDIALOG); länken är sparad privat.');
  }
  spawnSync('open', [lank]);
  console.log(`Öppnade provärendet på ${BAS} i webbläsaren.`);
}

const [kommando, flagga] = process.argv.slice(2);
const kod = await ({ start, stopp, status, oppna: () => oppna(flagga === '--ny') }[kommando] || (async () => {
  console.error('Använd: npm run prov -- start | oppna [--ny] | status | stopp');
  return 2;
}))();
process.exitCode = typeof kod === 'number' ? kod : 0;
