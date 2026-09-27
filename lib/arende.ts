// Ärendets operationer: skapa, länkar, svar, rättelser, nästa fråga, material, inlämning och export.
// Alla ändringar går genom uppdateraDok (ETag) och är idempotenta på klientens nyckel, så omladdning, dubbelklick,
// två flikar och återförsök aldrig ger dubbla svar, bilagor eller frågor.
import { BANK, grundFraga, luckor, regelFraga, rubrik, serUtSomHemlighet, utlosta } from './bank';
import { hashaToken, nyToken, nyttId } from './atkomst';
import { ledNasta, type Kandidat, type LedarIndata } from './intervjuledare';
import { lasDok, laggFil, skapaDok, taBortFil, uppdateraDok } from './lagring';
import { MAX_ANTAL, MAX_TOTAL, extrahera } from './material';
import { signalera } from './overlamning';
import { samlaBehov, laggBehov, tackning, behovMedStatus } from './tackning';
import type { AiLage, Arende, Fakta, FaktaAi, Fraga, Lank, Material, Rattelse, Svar } from './typer';

export class Vagrad extends Error {
  status: number;
  constructor(msg: string, status = 400) {
    super(msg);
    this.status = status;
  }
}

const MAX_AI_ANROP = Number(process.env.KUNDSTART_AI_MAX_ANROP || 60);
const MAX_SVAR_TECKEN = 4000;
const MIN_MS_MELLAN_SVAR = 2000; // tidsstämplar har sekundupplösning; idempotensnyckeln är det egentliga skyddet
const PAUS_EFTER_FEL = 3;
const PAUS_MIN = 10;

export const nu = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const arendeStig = (id: string) => `arenden/${id}.json`;
const lankStig = (hash: string) => `lankar/${hash}.json`;

export function aiLageStandard(): AiLage {
  const v = process.env.KUNDSTART_AI as AiLage | undefined;
  if (v === 'gateway' || v === 'claude-cli' || v === 'regelstyrd') return v;
  return process.env.VERCEL ? 'gateway' : 'regelstyrd';
}

function handelse(a: Arende, typ: string, detaljer?: Record<string, unknown>) {
  a.handelser.push({ tid: nu(), typ, revision: a.revision, detaljer });
  if (a.handelser.length > 300) a.handelser.splice(0, a.handelser.length - 300);
}

function bump(a: Arende) {
  a.revision += 1;
  a.uppdaterad = nu();
}

// ---------- skapa, läsa, länkar ----------

export async function skapaArende(p: { kund: { slug: string; namn: string }; kontakt?: string; kanal?: string; testdialog?: boolean; fakta?: Fakta[]; ai?: AiLage; lank_dagar?: number }): Promise<{ a: Arende; token: string; hash: string; utgar: string }> {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(p.kund.slug)) throw new Vagrad('kund.slug: små bokstäver, siffror och bindestreck');
  if (!p.kund.namn || p.kund.namn.length > 120) throw new Vagrad('kund.namn saknas eller är för långt');
  const fakta = (p.fakta || []).map((f) => {
    if (!BANK.statusar.includes(f.status)) throw new Vagrad('okänd status: ' + f.status);
    return { nyckel: String(f.nyckel).slice(0, 60), varde: String(f.varde).slice(0, 1000), status: f.status, kalla: String(f.kalla).slice(0, 200), omrade: String(f.omrade).slice(0, 2), datum: f.datum || nu().slice(0, 10) };
  });
  const id = nyttId('ar');
  // Första länken skapas tillsammans med ärendet, så att skapandet är en skrivning per dokument utan villkorad uppdatering.
  const token = nyToken();
  const hash = hashaToken(token);
  const utgar = new Date(Date.now() + (p.lank_dagar || 30) * 86400_000).toISOString();
  const a: Arende = {
    schema: 'kundstart-arende/1',
    id,
    kund: { slug: p.kund.slug, namn: p.kund.namn },
    kontakt: p.kontakt,
    kanal: p.kanal || 'Kundstart-länk',
    testdialog: Boolean(p.testdialog),
    skapad: nu(),
    uppdaterad: nu(),
    revision: 1,
    fakta_forifyllda: fakta,
    fragor: [],
    svar: [],
    rattelser: [],
    fakta_ai: [],
    material: [],
    foljdregler_utlosta: [],
    ai: { lage: p.ai || aiLageStandard(), anrop: 0, tokens_in: 0, tokens_out: 0, fel: 0 },
    omgang: 0,
    inlamningar: [],
    handelser: [],
  };
  handelse(a, 'skapad', { fakta: fakta.length, ai: a.ai.lage });
  handelse(a, 'lank_skapad', { hash: hash.slice(0, 12), utgar });
  const l: Lank = { arende_id: id, skapad: nu(), utgar, aterkallad: null, anvandningar: 0 };
  await skapaDok(lankStig(hash), l);
  await skapaDok(arendeStig(id), a);
  return { a, token, hash, utgar };
}

export async function lasArende(id: string): Promise<Arende | null> {
  if (!/^ar_[A-Za-z0-9_-]{8,20}$/.test(id)) return null;
  const r = await lasDok<Arende>(arendeStig(id));
  return r?.data ?? null;
}

export async function skapaLank(arendeId: string, dagar = 30): Promise<{ token: string; hash: string; utgar: string }> {
  const a = await lasArende(arendeId);
  if (!a) throw new Vagrad('ärendet finns inte', 404);
  const token = nyToken();
  const hash = hashaToken(token);
  const utgar = new Date(Date.now() + dagar * 86400_000).toISOString();
  const l: Lank = { arende_id: arendeId, skapad: nu(), utgar, aterkallad: null, anvandningar: 0 };
  await skapaDok(lankStig(hash), l);
  await uppdateraDok<Arende>(arendeStig(arendeId), (x) => {
    bump(x);
    handelse(x, 'lank_skapad', { hash: hash.slice(0, 12), utgar });
    return x;
  });
  return { token, hash, utgar };
}

export async function lasLank(hash: string): Promise<Lank | null> {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const r = await lasDok<Lank>(lankStig(hash));
  return r?.data ?? null;
}

export function lankGiltig(l: Lank | null): l is Lank {
  return Boolean(l && !l.aterkallad && new Date(l.utgar).getTime() > Date.now());
}

export async function noteraLankAnvand(hash: string): Promise<void> {
  await uppdateraDok<Lank>(lankStig(hash), (l) => {
    l.anvand_senast = nu();
    l.anvandningar += 1;
    return l;
  });
}

export async function aterkallaLank(hash: string): Promise<Lank> {
  const r = await uppdateraDok<Lank>(lankStig(hash), (l) => {
    if (l.aterkallad) return null;
    l.aterkallad = nu();
    return l;
  });
  await uppdateraDok<Arende>(arendeStig(r.data.arende_id), (x) => {
    bump(x);
    handelse(x, 'lank_aterkallad', { hash: hash.slice(0, 12) });
    return x;
  });
  return r.data;
}

// ---------- härledda vyer ----------

export interface BildRad {
  nyckel: string;
  rubrik: string;
  omrade: string;
  varde: string;
  typ: 'kund' | 'forifylld' | 'ai';
  status: string;
  kalla: string;
  tid: string;
  fraga_id?: string;
}

/** Vår bild av kunden: per nyckel gäller kundens senaste ord (rättelse eller svar) före AI:ns tolkning före det förifyllda. */
export function bild(a: Arende): BildRad[] {
  const rader = new Map<string, BildRad>();
  for (const f of a.fakta_forifyllda) {
    if (f.status === 'okänt') continue;
    rader.set(f.nyckel, { nyckel: f.nyckel, rubrik: rubrik(f.nyckel), omrade: f.omrade, varde: f.varde, typ: 'forifylld', status: f.status, kalla: f.kalla, tid: f.datum });
  }
  for (const f of a.fakta_ai) {
    if (!f.giltig) continue;
    rader.set(f.nyckel, { nyckel: f.nyckel, rubrik: rubrik(f.nyckel), omrade: f.omrade, varde: f.varde, typ: 'ai', status: f.status, kalla: f.kalla, tid: f.datum });
  }
  const senasteKund = new Map<string, { varde: string; tid: string; revision: number; fraga_id?: string; kalla: string }>();
  for (const s of a.svar) {
    const b = senasteKund.get(s.nyckel);
    if (b && b.revision > s.revision) continue;
    if (s.typ === 'vet_inte') {
      senasteKund.set(s.nyckel, { varde: 'Vet inte – behöver följas upp', tid: s.mottaget, revision: s.revision, fraga_id: s.fraga_id, kalla: 'kundens svar ' + s.fraga_id });
      continue;
    }
    senasteKund.set(s.nyckel, { varde: s.text, tid: s.mottaget, revision: s.revision, fraga_id: s.fraga_id, kalla: 'kundens svar ' + s.fraga_id });
  }
  for (const r of a.rattelser) {
    const b = senasteKund.get(r.nyckel);
    if (!b || b.revision <= r.revision) senasteKund.set(r.nyckel, { varde: r.varde, tid: r.mottaget, revision: r.revision, kalla: 'kundens rättelse' });
  }
  for (const [nyckel, k] of senasteKund) {
    const omrade = rader.get(nyckel)?.omrade || a.fragor.find((f) => f.nyckel === nyckel)?.omrade || '';
    rader.set(nyckel, { nyckel, rubrik: rubrik(nyckel), omrade, varde: k.varde, typ: 'kund', status: 'kunden uppger', kalla: k.kalla, tid: k.tid, fraga_id: k.fraga_id });
  }
  return [...rader.values()].sort((x, y) => x.omrade.localeCompare(y.omrade) || x.rubrik.localeCompare(y.rubrik, 'sv'));
}

function kandaNycklar(a: Arende): Set<string> {
  const s = new Set<string>();
  for (const f of a.fakta_forifyllda) if (f.status !== 'okänt') s.add(f.nyckel);
  for (const f of a.fakta_ai) if (f.giltig) s.add(f.nyckel);
  for (const x of a.svar) s.add(x.nyckel);
  for (const r of a.rattelser) s.add(r.nyckel);
  return s;
}

export function kandidater(a: Arende): Kandidat[] {
  const stalldaIds = new Set(a.fragor.filter((f) => f.status !== 'senare').map((f) => f.id));
  const allaIds = new Set(a.fragor.map((f) => f.id));
  const senareIds = new Set(a.fragor.filter((f) => f.status === 'senare').map((f) => f.id));
  const kanda = kandaNycklar(a);
  const ut: Kandidat[] = [];
  for (const b of behovMedStatus(a)) if (b.status === 'oppen' && (!allaIds.has(b.id) || senareIds.has(b.id))) ut.push({ id: b.id, omrade: 'H', nyckel: b.nyckel, text: b.fraga, paverkar: 'Kundens uppgift i ' + b.kalla_fraga + ': ' + b.citat.slice(0, 200), prio: 1, foljd: true, senare: senareIds.has(b.id) });
  for (const u of a.foljdregler_utlosta) {
    const regel = BANK.foljdregler.find((r) => r.namn === u.regel);
    if (!regel) continue;
    for (const f of regel.fragor) {
      if (allaIds.has(f.id) && !senareIds.has(f.id)) continue;
      if (kanda.has(f.nyckel)) continue;
      if (ut.some((k) => k.id === f.id)) continue;
      ut.push({ id: f.id, omrade: f.omrade, nyckel: f.nyckel, text: f.text, paverkar: regel.paverkar, prio: 1, foljd: true, utlost_av: `${u.fraga_id}: "${u.traff}"`, senare: senareIds.has(f.id) });
    }
  }
  for (const g of luckor(kanda, stalldaIds)) ut.push({ id: g.id, omrade: g.omrade, nyckel: g.nyckel, text: g.text, paverkar: g.paverkar, prio: g.prio, foljd: false, senare: senareIds.has(g.id) });
  return ut.sort((x, y) => Number(x.senare) - Number(y.senare) || Number(y.foljd) - Number(x.foljd) || x.prio - y.prio);
}

export function oppenFraga(a: Arende): Fraga | undefined {
  return a.fragor.find((f) => f.status === 'stalld');
}

/** Vad som återstår när det är känt: följdfrågor och prioritet 1-luckor. Ingen procent, ingen tid. */
export function aterstar(a: Arende): { viktiga: number; ovriga: number } {
  const k = kandidater(a).filter((x) => !x.senare);
  return { viktiga: k.filter((x) => x.foljd || x.prio === 1).length, ovriga: k.filter((x) => !x.foljd && x.prio > 1).length };
}

/** En generell ”vem kan veta?”-följd behövs bara medan dess källsvar är okänt. */
function aktualiseraOkant(a: Arende) {
  a.foljdregler_utlosta = a.foljdregler_utlosta.filter(u => u.regel !== 'okant' || (() => {
    const s = [...a.svar].reverse().find(s => s.fraga_id === u.fraga_id);
    const r = s && [...a.rattelser].reverse().find(r => r.nyckel === s.nyckel && r.revision > s.revision);
    return s?.typ === 'vet_inte' && !r;
  })());
  if (a.foljdregler_utlosta.some(u => u.regel === 'okant')) return;
  const ids = new Set(BANK.foljdregler.find(r => r.namn === 'okant')?.fragor.map(f => f.id));
  // Besvarad historik rörs inte. Bara en ännu obesvarad fråga som saknar sin
  // utlösande okända uppgift tas bort när kunden själv lämnat beskedet.
  a.fragor = a.fragor.filter(f => !ids.has(f.id) || a.svar.some(s => s.fraga_id === f.id) || (f.status !== 'stalld' && f.status !== 'senare'));
}

// ---------- svar och rättelser ----------

export async function registreraSvar(id: string, p: { fraga_id: string; text: string; typ: Svar['typ']; idempotens: string }): Promise<{ a: Arende; ny: boolean }> {
  const text = (p.typ === 'vet_inte' ? 'Vet inte' : String(p.text || '')).replace(/\r\n/g, '\n').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.idempotens)) throw new Vagrad('idempotensnyckel saknas');
  if (p.typ !== 'vet_inte' && !text) throw new Vagrad('svaret är tomt');
  if (text.length > MAX_SVAR_TECKEN) throw new Vagrad(`svaret är längre än ${MAX_SVAR_TECKEN} tecken`);
  if (serUtSomHemlighet(text)) throw new Vagrad('svaret ser ut att innehålla ett lösenord eller en nyckel; ta bort det, så ordnar vi åtkomst på säker väg', 422);
  let ny = false;
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    ny = false;
    if (a.svar.some((s) => s.idempotens === p.idempotens)) return null;
    const f = a.fragor.find((x) => x.id === p.fraga_id);
    if (!f) throw new Vagrad('frågan finns inte i ärendet', 404);
    if (f.typ === 'val' && p.typ === 'val' && !(f.alternativ || []).includes(text)) throw new Vagrad('okänt alternativ');
    const tidigare = [...a.svar].reverse().find((x) => x.fraga_id === f.id);
    // Samma text igen (annan flik, återförsök, dubbelklick med ny nyckel): ingen ny rad. Annan text på en redan
    // besvarad fråga: ett ändrat svar som ersätter det förra synligt, aldrig en dubblett.
    if (tidigare && tidigare.text === text && tidigare.typ === p.typ) return null;
    if (tidigare && Date.now() - new Date(tidigare.mottaget).getTime() < MIN_MS_MELLAN_SVAR && tidigare.text === text) return null;
    bump(a);
    const s: Svar = { fraga_id: f.id, nyckel: f.nyckel, omrade: f.omrade, text, typ: p.typ, mottaget: nu(), revision: a.revision, idempotens: p.idempotens, ersatter: tidigare ? tidigare.revision : undefined };
    const rad = bild(a).find(b => b.nyckel === 'erbjudande');
    a.svar.push(s);
    f.status = 'besvarad';
    const behov = a.behov?.find(b => b.id === f.id);
    if (behov) behov.status = p.typ === 'vet_inte' || p.typ === 'atkomst_saknas' ? 'oppen' : 'besvarad';
    if (behov && (p.typ === 'vet_inte' || p.typ === 'atkomst_saknas')) f.status = 'senare';
    samlaBehov(a, s, rad ? {varde:rad.varde,kalla:rad.kalla,typ:rad.typ === 'kund' ? 'svar' : rad.typ} : undefined);
    signalera(a);
    for (const t of a.fakta_ai) if (t.nyckel === f.nyckel && t.giltig) { t.giltig = false; t.forkastad_skal = 'kundens senare svar ' + f.id; }
    if (p.typ !== 'vet_inte') {
      for (const u of utlosta(text)) {
        if (u.negerad) {
          a.foljdregler_negerade = a.foljdregler_negerade || [];
          if (!a.foljdregler_negerade.some((x) => x.regel === u.regel.namn && x.fraga_id === f.id)) a.foljdregler_negerade.push({ regel: u.regel.namn, fraga_id: f.id, traff: u.traff, sats: u.sats, tid: nu() });
          continue;
        }
        if (!a.foljdregler_utlosta.some((x) => x.regel === u.regel.namn && x.fraga_id === f.id)) a.foljdregler_utlosta.push({ regel: u.regel.namn, fraga_id: f.id, traff: u.traff, tid: nu() });
      }
    } else {
      const okant = BANK.foljdregler.find((x) => x.namn === 'okant');
      if (okant && !a.foljdregler_utlosta.some((x) => x.regel === 'okant' && x.fraga_id === f.id)) a.foljdregler_utlosta.push({ regel: 'okant', fraga_id: f.id, traff: 'vet inte', tid: nu() });
    }
    aktualiseraOkant(a);
    handelse(a, 'svar', { fraga_id: f.id, typ: p.typ, tecken: text.length });
    ny = true;
    return a;
  });
  return { a: r.data, ny };
}

export async function skjutUpp(id: string, fragaId: string): Promise<Arende> {
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    const f = a.fragor.find((x) => x.id === fragaId && x.status === 'stalld');
    if (!f) return null;
    bump(a);
    f.status = 'senare';
    handelse(a, 'senare', { fraga_id: f.id });
    return a;
  });
  return r.data;
}

/** Öppnar en uppskjuten fråga igen på kundens begäran. */
export async function oppnaIgen(id: string, fragaId: string): Promise<Arende> {
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    const f = a.fragor.find((x) => x.id === fragaId && (x.status === 'senare' || (a.behov?.some(b => b.id === x.id) && x.status !== 'stalld')));
    if (!f) return null;
    bump(a);
    f.status = 'stalld';
    f.stalld = nu();
    f.oppnad_revision = a.revision;
    const behov = a.behov?.find(b => b.id === f.id);
    if (behov) { behov.status = 'oppen'; for (const t of a.fakta_ai) if (t.nyckel === f.nyckel && t.giltig) {t.giltig = false; t.forkastad_skal = 'kunden öppnade behovet igen';} }
    handelse(a, 'oppnad_igen', { fraga_id: f.id });
    return a;
  });
  return r.data;
}

export async function registreraRattelse(id: string, p: { nyckel: string; varde: string; idempotens: string }): Promise<{ a: Arende; ny: boolean }> {
  const varde = String(p.varde || '').replace(/\r\n/g, '\n').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.idempotens)) throw new Vagrad('idempotensnyckel saknas');
  if (!/^[a-z_]{2,60}$/.test(p.nyckel)) throw new Vagrad('okänd uppgift');
  if (!varde) throw new Vagrad('rättelsen är tom');
  if (varde.length > MAX_SVAR_TECKEN) throw new Vagrad('rättelsen är för lång');
  if (serUtSomHemlighet(varde)) throw new Vagrad('texten ser ut att innehålla ett lösenord eller en nyckel; ta bort det', 422);
  let ny = false;
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    ny = false;
    if (a.rattelser.some((x) => x.idempotens === p.idempotens)) return null;
    const rad = bild(a).find((b) => b.nyckel === p.nyckel);
    if (!rad && !a.fragor.some((f) => f.nyckel === p.nyckel)) throw new Vagrad('uppgiften finns inte i er bild', 404);
    if (rad && rad.varde === varde) return null;
    bump(a);
    const tidigare: Rattelse['tidigare'] = rad ? { varde: rad.varde, kalla: rad.kalla, typ: rad.typ === 'kund' ? 'svar' : rad.typ } : { varde: '', kalla: '', typ: 'ingen' };
    a.rattelser.push({ nyckel: p.nyckel, varde, mottaget: nu(), revision: a.revision, idempotens: p.idempotens, tidigare });
    for (const b of a.behov || []) if (b.nyckel === p.nyckel) { b.status = 'besvarad'; const f = a.fragor.find(f => f.id === b.id); if (f) f.status = 'besvarad'; }
    for (const t of a.fakta_ai) if (t.nyckel === p.nyckel && t.giltig) { t.giltig = false; t.forkastad_skal = 'kundens rättelse'; }
    signalera(a);
    aktualiseraOkant(a);
    handelse(a, 'rattelse', { nyckel: p.nyckel, tidigare: tidigare.typ });
    ny = true;
    return a;
  });
  return { a: r.data, ny };
}

// ---------- nästa fråga ----------

function tillIndata(a: Arende, k: Kandidat[]): LedarIndata {
  const fragaText = (fid: string) => a.fragor.find((f) => f.id === fid)?.text || fid;
  const dialog = a.svar.filter((s, index, arr) => arr.findLastIndex(x => x.fraga_id === s.fraga_id) === index).map((s) => ({ fraga_id: s.fraga_id, fraga: fragaText(s.fraga_id), svar: s.text }));
  return {
    kund: { namn: a.kund.namn },
    kanda: bild(a).map((b) => ({ nyckel: b.nyckel, varde: b.varde, kalla: b.typ === 'kund' ? 'kunden' : b.typ === 'ai' ? 'vår tolkning' : b.kalla })),
    dialog,
    senaste: dialog[dialog.length - 1] || null,
    kandidater: k, // Alla relevanta områden måste kunna täckas av ett flertematiskt svar.
    material: a.material.filter((m) => m.status === 'mottagen').length,
  };
}

export interface NastaResultat {
  a: Arende;
  fragor: Fraga[];
  klar: boolean;
  meddelande: string;
  ai: { lage: AiLage; anvand: boolean; fallback: boolean; fel?: string; modell?: string };
}

/** Nästa fråga: idempotent (en redan ställd fråga returneras utan nytt modellanrop). */
export async function nasta(id: string): Promise<NastaResultat> {
  const forsta = await lasArende(id);
  if (!forsta) throw new Vagrad('ärendet finns inte', 404);
  const oppen = forsta.fragor.filter((f) => f.status === 'stalld');
  if (oppen.length) return { a: forsta, fragor: oppen, klar: false, meddelande: '', ai: { lage: forsta.ai.lage, anvand: false, fallback: false } };
  const k = kandidater(forsta).filter((x) => !x.senare);
  if (k.length === 0) return { a: forsta, fragor: [], klar: true, meddelande: '', ai: { lage: forsta.ai.lage, anvand: false, fallback: false } };

  let lage: AiLage = forsta.ai.lage;
  let skal: string | undefined;
  if (lage !== 'regelstyrd' && forsta.ai.anrop >= MAX_AI_ANROP) { lage = 'regelstyrd'; skal = 'budget för AI-anrop i ärendet är slut'; }
  if (lage !== 'regelstyrd' && forsta.ai.paus_till && new Date(forsta.ai.paus_till).getTime() > Date.now()) { lage = 'regelstyrd'; skal = 'AI-stödet pausat efter upprepade fel'; }
  const basRevision = forsta.revision;
  const res = await ledNasta(tillIndata(forsta, k), lage, forsta.ai.modell || process.env.KUNDSTART_AI_MODELL || 'openai/gpt-5-mini', MAX_AI_ANROP - forsta.ai.anrop);
  const ut = res.utdata!;
  const anvandModell = lage !== 'regelstyrd';

  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    const annanHannFore = a.fragor.some((f) => f.status === 'stalld');
    if (annanHannFore && !anvandModell) return null;
    const inaktuell = a.revision !== basRevision;
    bump(a);
    a.ai.aktuell = skal ? 'pausad' : res.fallback ? 'reserv' : lage === 'regelstyrd' ? 'av' : 'aktiv';
    a.ai.felklass = res.felklass;
    a.ai.diagnostik = res.diagnostik;
    if (anvandModell) {
      a.ai.anrop += res.forsok || 1;
      a.ai.tokens_in += res.tokens_in;
      a.ai.tokens_out += res.tokens_out;
      if (res.fel) {
        a.ai.fel += 1;
        a.ai.fel_i_rad = (a.ai.fel_i_rad || 0) + 1;
        a.ai.senaste_fel = res.fel;
        a.ai.senaste_fel_tid = nu();
        if (a.ai.fel_i_rad >= PAUS_EFTER_FEL) {
          a.ai.paus_till = new Date(Date.now() + PAUS_MIN * 60_000).toISOString();
          a.ai.fel_i_rad = 0;
        }
      } else {
        a.ai.fel_i_rad = 0;
        a.ai.modell = res.modell; // modellen som faktiskt svarade
        a.ai.senaste_lyckade = nu();
      }
    }
    if (annanHannFore || inaktuell) {
      handelse(a, 'nasta_forkastad', { skal: inaktuell ? 'kundrevisionen ändrades under modellväntan; inget gammalt modellinnehåll används' : 'en annan flik hann ställa nästa fråga; anropet bokfört', lage: res.lage });
      return a; // bara räknarna sparas; frågorna från detta anrop används inte
    }
    for (const b of ut.behov || []) {
      const kallSvar = [...a.svar].reverse().find(s => s.text.includes(b.citat));
      if (kallSvar) laggBehov(a, b, kallSvar, 'ai');
    }
    const kNu = new Map(kandidater(a).map((x) => [x.id, x]));
    const senareRattat = new Set([...a.rattelser.filter((x) => x.revision > basRevision).map((x) => x.nyckel), ...a.svar.filter((x) => x.revision > basRevision).map((x) => x.nyckel)]);
    const modell = res.modell || 'regelstyrd';
    const kalla = `kundstart AI rev ${basRevision} (${modell})`;
    for (const t of ut.tackta) {
      const kand = kNu.get(t.fraga_id);
      if (!kand || senareRattat.has(kand.nyckel)) continue;
      a.fragor.push({ id: kand.id, omrade: kand.omrade, nyckel: kand.nyckel, text: kand.text, paverkar: kand.paverkar, utlost_av: kand.utlost_av ?? null, kalla: a.behov?.some(b => b.id === kand.id) ? 'behov' : 'bank', typ: 'oppen', omgang: a.omgang, stalld: nu(), status: 'tackt', valjare: 'ai' });
      const behov = a.behov?.find(b => b.id === kand.id); if (behov) behov.status = 'tackt';
      a.fakta_ai.push({ nyckel: kand.nyckel, varde: t.varde, status: 'tolkning', kalla: kalla + ' täckt av svar', omrade: kand.omrade, datum: nu().slice(0, 10), bas_revision: basRevision, giltig: true, modell: res.modell });
    }
    // Kundens egna nycklar i samtalet: en förifylld uppgift som kunden inte rört får inte skrivas om som "vår tolkning".
    const kundensNycklar = new Set([...a.svar.map((x) => x.nyckel), ...a.rattelser.map((x) => x.nyckel), ...ut.tackta.map((t) => kNu.get(t.fraga_id)?.nyckel).filter(Boolean)]);
    for (const b of ut.bild) {
      if (a.fakta_forifyllda.some((f) => f.nyckel === b.nyckel) && !kundensNycklar.has(b.nyckel)) continue;
      if (senareRattat.has(b.nyckel)) {
        a.fakta_ai.push({ nyckel: b.nyckel, varde: b.varde, status: 'tolkning', kalla, omrade: kNu.get(b.nyckel)?.omrade || '', datum: nu().slice(0, 10), bas_revision: basRevision, giltig: false, forkastad_skal: 'kundens rättelse efter revision ' + basRevision, modell: res.modell });
        continue;
      }
      if (a.rattelser.some((x) => x.nyckel === b.nyckel)) continue; // kundens rättelse står alltid över AI:ns bild
      for (const t of a.fakta_ai) if (t.nyckel === b.nyckel && t.giltig && t.kalla.startsWith('kundstart AI')) t.giltig = false;
      const omrade = kNu.get(b.nyckel)?.omrade || a.fragor.find((f) => f.nyckel === b.nyckel)?.omrade || '';
      a.fakta_ai.push({ nyckel: b.nyckel, varde: b.varde, status: 'tolkning', kalla, omrade, datum: nu().slice(0, 10), bas_revision: basRevision, giltig: true, modell: res.modell });
    }
    const valda = ut.valda.filter((v) => kNu.has(v.id));
    if (valda.length === 0 && !ut.klar) {
      const forstaK = kandidater(a).find((x) => !x.senare);
      if (forstaK) valda.push({ id: forstaK.id, text: forstaK.text, typ: 'oppen', alternativ: [] });
    }
    if (valda.length) a.omgang += 1;
    for (const v of valda) {
      const kand = kNu.get(v.id)!;
      const senare = a.fragor.find((f) => f.id === v.id && f.status === 'senare');
      if (senare) a.fragor.splice(a.fragor.indexOf(senare), 1);
      a.fragor.push({ id: kand.id, omrade: kand.omrade, nyckel: kand.nyckel, text: v.text, banktext: v.text !== kand.text ? kand.text : undefined, paverkar: kand.paverkar, utlost_av: kand.utlost_av ?? null, kalla: kand.id.startsWith('BEH') ? 'behov' : v.text !== kand.text ? 'ai-omformulering' : 'bank', typ: v.typ, alternativ: v.alternativ.length ? v.alternativ : undefined, omgang: a.omgang, stalld: nu(), status: 'stalld', valjare: res.lage === 'regelstyrd' ? 'regelstyrd' : 'ai' });
    }
    handelse(a, 'nasta', { lage: res.lage, fallback: res.fallback, fel: res.fel, valda: valda.map((v) => v.id), tackta: ut.tackta.map((t) => t.fraga_id), ms: res.ms, skal, felklass: res.felklass, diagnostik: res.diagnostik });
    return a;
  });
  const a = r.data;
  const fragor = a.fragor.filter((f) => f.status === 'stalld');
  return { a, fragor, klar: fragor.length === 0, meddelande: ut.meddelande, ai: { lage: res.lage, anvand: anvandModell && !res.fallback, fallback: res.fallback, fel: res.fel || skal, modell: res.modell } };
}

// ---------- material ----------

export async function laggMaterialFil(id: string, p: { filnamn: string; mime: string; data: ArrayBuffer; sha256: string; beskrivning?: string; idempotens: string }): Promise<{ a: Arende; ny: boolean }> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.idempotens)) throw new Vagrad('idempotensnyckel saknas');
  const befintlig = await lasArende(id);
  if (!befintlig) throw new Vagrad('ärendet finns inte', 404);
  if (befintlig.material.some((m) => m.idempotens === p.idempotens)) return { a: befintlig, ny: false };
  const aktiva = befintlig.material.filter((m) => m.status === 'mottagen' && m.typ === 'fil');
  if (aktiva.some((m) => m.sha256 === p.sha256)) return { a: befintlig, ny: false }; // samma innehåll igen (återförsök): ingen dubblett
  if (aktiva.length >= MAX_ANTAL) throw new Vagrad(`högst ${MAX_ANTAL} filer per ärende`, 422);
  if (aktiva.reduce((s, m) => s + (m.storlek || 0), 0) + p.data.byteLength > MAX_TOTAL) throw new Vagrad('den sammanlagda storleken på filerna är för stor', 422);
  const extraktion = extrahera(p.mime, new Uint8Array(p.data), p.sha256);
  const mid = nyttId('m');
  const blobStig = await laggFil(`material/${id}/${mid}`, p.data, p.mime);
  let ny = false;
  try {
    const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
      ny = false;
      if (a.material.some((m) => m.idempotens === p.idempotens)) return null;
      const nuAktiva = a.material.filter(m => m.status === 'mottagen' && m.typ === 'fil');
      if (nuAktiva.some(m => m.sha256 === p.sha256)) return null;
      if (nuAktiva.length >= MAX_ANTAL || nuAktiva.reduce((sum, m) => sum + (m.storlek || 0), 0) + p.data.byteLength > MAX_TOTAL) throw new Vagrad('materialgränsen har nåtts', 422);
      bump(a);
      const m: Material = { extraktion, id: mid, typ: 'fil', filnamn: p.filnamn, mime: p.mime, storlek: p.data.byteLength, sha256: p.sha256, blob: blobStig, beskrivning: p.beskrivning?.slice(0, 300), status: 'mottagen', mottaget: nu(), revision: a.revision, idempotens: p.idempotens };
      a.material.push(m);
      signalera(a);
      handelse(a, 'material', { id: mid, mime: p.mime, storlek: p.data.byteLength });
      ny = true;
      return a;
    });
    if (!ny) await taBortFil(blobStig).catch(() => undefined);
    return { a: r.data, ny };
  } catch (fel) {
    // A transport failure can follow a committed CAS. Read back before deleting
    // so an acknowledged-but-lost write cannot leave a dangling material reference.
    const aktuell = await lasArende(id);
    if (!aktuell?.material.some(m => m.blob === blobStig)) await taBortFil(blobStig);
    throw fel;
  }
}

export async function laggMaterialLank(id: string, p: { url: string; beskrivning?: string; idempotens: string }): Promise<{ a: Arende; ny: boolean }> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.idempotens)) throw new Vagrad('idempotensnyckel saknas');
  let ny = false;
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    ny = false;
    if (a.material.some((m) => m.idempotens === p.idempotens)) return null;
    if (a.material.filter((m) => m.status === 'mottagen').length >= MAX_ANTAL * 2) throw new Vagrad('för många poster', 422);
    bump(a);
    const m: Material = { id: nyttId('m'), typ: 'lank', url: p.url, beskrivning: p.beskrivning?.slice(0, 300), status: 'mottagen', mottaget: nu(), revision: a.revision, idempotens: p.idempotens };
    a.material.push(m);
    signalera(a);
    handelse(a, 'material_lank', { id: m.id });
    ny = true;
    return a;
  });
  return { a: r.data, ny };
}

export async function taBortMaterial(id: string, mid: string): Promise<Arende> {
  let blob: string | undefined;
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    const m = a.material.find((x) => x.id === mid);
    if (!m || m.status === 'borttagen') return null;
    bump(a);
    m.status = 'borttagen';
    signalera(a);
    blob = m.blob;
    handelse(a, 'material_borttaget', { id: mid });
    return a;
  });
  if (blob) await taBortFil(blob).catch(() => undefined);
  return r.data;
}

// ---------- inlämning ----------

export async function lamnaIn(id: string): Promise<Arende> {
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    const sista = a.inlamningar[a.inlamningar.length - 1];
    if (sista && sista.revision === a.revision) return null;
    bump(a);
    a.inlamningar.push({ tid: nu(), revision: a.revision, svar: a.svar.length, material: a.material.filter((m) => m.status === 'mottagen').length });
    signalera(a, 'inlamning');
    handelse(a, 'inlamnad', { svar: a.svar.length });
    return a;
  });
  return r.data;
}

// ---------- export till Digitala ----------

export function exportPaket(a: Arende) {
  const omgangar = [...new Set(a.fragor.map((f) => f.omgang))].sort((x, y) => x - y).map((nr) => {
    const fragor = a.fragor.filter((f) => f.omgang === nr);
    const svar = a.svar.filter((s) => fragor.some((f) => f.id === s.fraga_id));
    const svarMd = svar.map((s) => `### ${s.fraga_id}\n${s.text}\n`).join('\n');
    return { nr, skapad: fragor[0]?.stalld, fragor, svar, svar_md: svarMd };
  });
  const faktaAi = a.fakta_ai.filter((f) => f.giltig).map((f) => ({ nyckel: f.nyckel, varde: f.varde, status: f.status, kalla: f.kalla, omrade: f.omrade, datum: f.datum }));
  const rattelserFakta = a.rattelser.map((r) => ({ nyckel: r.nyckel, varde: r.varde, status: 'kunden uppger', kalla: `kundstart rättelse rev ${r.revision}`, omrade: a.fragor.find((f) => f.nyckel === r.nyckel)?.omrade || a.fakta_forifyllda.find((f) => f.nyckel === r.nyckel)?.omrade || 'H', datum: r.mottaget.slice(0, 10), tidigare: r.tidigare }));
  return {
    schema: 'kundstart-export/1',
    exporterad: nu(),
    arende: { id: a.id, kund: a.kund, kanal: a.kanal, testdialog: a.testdialog, skapad: a.skapad, revision: a.revision, inlamningar: a.inlamningar },
    bank: BANK.kalla,
    signal: a.signal,
    kvittenser: a.kvittenser || [],
    returfragor: a.returfragor || [],
    behov: behovMedStatus(a),
    tackning: tackning(a),
    ai: a.ai,
    fakta_forifyllda: a.fakta_forifyllda,
    omgangar,
    svar: a.svar,
    rattelser: a.rattelser,
    fakta_ai: faktaAi,
    rattelser_fakta: rattelserFakta,
    material: a.material.filter((m) => m.status === 'mottagen').map((m) => ({ id: m.id, typ: m.typ, filnamn: m.filnamn, mime: m.mime, storlek: m.storlek, sha256: m.sha256, url: m.url, beskrivning: m.beskrivning, mottaget: m.mottaget, revision: m.revision, extraktion: m.extraktion, lasning: m.lasning, lasstatus: m.lasning ? 'last' : m.extraktion ? 'extraherad' : 'mottagen' })),
    foljdregler_utlosta: a.foljdregler_utlosta,
    foljdregler_negerade: a.foljdregler_negerade || [],
    handelser: a.handelser.slice(-100),
  };
}

export function beskrivFraga(f: Fraga): string {
  const g = grundFraga(f.id);
  if (g) return g.paverkar;
  const r = regelFraga(f.id);
  return r ? r.regel.paverkar : f.paverkar;
}

export type { FaktaAi };
