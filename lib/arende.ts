// Ärendets operationer: skapa, länkar, svar, rättelser, agentens tur, tillval, material, inlämning och export.
// Alla ändringar går genom uppdateraDok (ETag) och är idempotenta på klientens nyckel, så omladdning, dubbelklick,
// två flikar och återförsök aldrig ger dubbla svar, bilagor, tillval eller frågor. Ett ärende är ett dokument: samtalet
// och översikten "Ditt uppdrag" är två vyer av samma dokument.
import { BANK, grundFraga, luckor, regelFraga, rubrik, serUtSomHemlighet, utlosta } from './bank';
import { hashaToken, nyToken, nyttId } from './atkomst';
import { SYNTES_SCHEMA, TUR_SCHEMA, byggSyntesKontext, byggTurKontext, syntesSystemText, turSystemText, valideraSyntes, valideraTur, type KandRad, type SyntesUtdata, type TurUtdata } from './agent';
import { avrakna, kostnadUrToken, maxKostnad, reservera } from './budget';
import { kontrolleraDoman, normaliseraDoman, type DomanKontroll } from './doman';
import { lasDok, laggFil, skapaDok, taBortFil, uppdateraDok } from './lagring';
import { MAX_ANTAL, MAX_TOTAL, extrahera } from './material';
import { ModellFel, viaClaudeCli, viaGateway, type ModellSvar } from './modell';
import { lasProv, lasSyntesProv, provTillatet, syntesTimeoutMs, turTimeoutMs, type ProvVal } from './provlage';
import { signalera } from './overlamning';
import { samlaBehov, laggBehov, tackning, behovMedStatus } from './tackning';
import { TILLVAL_IDS, annatId, arAnnat } from './tillval';
import type { AiLage, Arende, Fakta, FaktaAi, Fas, FasByte, Fraga, Lank, Material, Rattelse, Svar, Syntes, Tillval, TillvalDigitala, TillvalKundval } from './typer';
import { SAMTYCKE } from './samtycke';

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
/** Turen är liten (återkoppling + fråga); syntesen bär alla noteringar och får vara stor. Omtaget bara efter faktisk avkortning. */
const TUR_MAX_TOKENS = 2500;
const TUR_MAX_TOKENS_OMTAG = 4000;
const SYNTES_MAX_TOKENS = 12000;
const SYNTES_MAX_TOKENS_OMTAG = 16000;
/** En gatewaytur (alla försök) ryms i /api/nasta:s maxDuration 60 s med marginal för slutskrivningen och domänkontrollen. */
const TUR_MS = 45_000;
const LAS_MS = 80_000;
const MAX_RESEARCH = 6;
const MAX_ANNAT = 8;
const MAX_DOMANKONTROLLER_PER_TIMME = 10;
// Samtalet får avslutas (av intervjuaren, standardlistan eller kunden) när inga viktiga områden står orörda och minst
// MINST_FRAGOR frågor ställts, eller efter AVSLUT_EFTER_FRAGOR frågor. Miljövariabeln finns för verkliga modellprov som
// behöver en kort intervju; golvet behövs eftersom förifyllda uppgifter räknas som täckta.
export const AVSLUT_EFTER_FRAGOR = Math.max(1, Number(process.env.KUNDSTART_AVSLUT_EFTER_FRAGOR) || 14);
const MINST_FRAGOR = 6;
/** Hela svaret säger bara "vet inte": sparas som ett ärligt okänt (typ vet_inte), inte som en uppgift. */
const VET_INTE_HELT = /^(?:vi |jag )?(?:vet (?:inte|ej)(?: riktigt)?|har ingen aning|ingen aning)[.!…]*$/i;
/** Avslutsfrågan (sista tankar): samtalets ram, inte ett bankämne. Intervjuaren får formulera den själv. */
export const AVSLUT_FRAGA = { nyckel: 'avslut', omrade: 'H', text: 'Är det något mer ni vill ta upp innan vi går vidare?', paverkar: 'det sista ni vill att vi tar med' };
export const OPPNING_INLEDNING = 'Tack för att ni tar er tid. Vi börjar med det viktigaste.';

export const nu = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const arendeStig = (id: string) => `arenden/${id}.json`;
const lankStig = (hash: string) => `lankar/${hash}.json`;

/** Nya ärendens läge. Utan uttryckligt KUNDSTART_AI gäller standardlistan överallt, även på Vercel: ingen kostnads-AI
 *  (ägarens besked 2026-09-29). gateway slås på med KUNDSTART_AI=gateway, testläget med KUNDSTART_AI=claude-cli lokalt. */
export function aiLageStandard(): AiLage {
  const v = process.env.KUNDSTART_AI as AiLage | undefined;
  if (v === 'gateway' || v === 'claude-cli' || v === 'regelstyrd') return v;
  return 'regelstyrd';
}

/** Gateway anropas bara när servern uttryckligen startats med KUNDSTART_AI=gateway, också för äldre ärenden som
 *  skapades med gateway som läge. */
export function gatewayPa(): boolean {
  return process.env.KUNDSTART_AI === 'gateway';
}

/** Det läge ett ärende faktiskt får i den här miljön: ett läge som miljön inte tillåter blir standardlistan. */
export function effektivtLage(lage: AiLage): AiLage {
  if (lage === 'gateway' && gatewayPa()) return 'gateway';
  if (lage === 'claude-cli' && provTillatet()) return 'claude-cli';
  return 'regelstyrd';
}

export function standardModell(): string {
  return process.env.KUNDSTART_AI_MODELL || 'openai/gpt-5-mini';
}

function handelse(a: Arende, typ: string, detaljer?: Record<string, unknown>) {
  a.handelser.push({ tid: nu(), typ, revision: a.revision, detaljer });
  if (a.handelser.length > 300) a.handelser.splice(0, a.handelser.length - 300);
}

function bump(a: Arende) {
  a.revision += 1;
  a.uppdaterad = nu();
}

// ---------- faser ----------

/** Kundens senaste ändring: svar, rättelse, material eller tillval. Frågor som skapas räknas inte. */
export function kundRevision(a: Arende): number {
  return Math.max(0, ...a.svar.map((s) => s.revision), ...a.rattelser.map((r) => r.revision), ...a.material.map((m) => m.revision), ...(a.tillval || []).map((t) => t.revision));
}

/** Har kunden (eller Digitala med returfrågor) ändrat något efter en inlämning eller en sammanfattning? */
export function andratEfter(a: Arende, bas: { revision: number; tid?: string }): boolean {
  return a.fragor.some((f) => f.status === 'stalld' && (f.kalla === 'returfraga' || (f.oppnad_revision || 0) > bas.revision || (bas.tid !== undefined && f.stalld > bas.tid))) || kundRevision(a) > bas.revision;
}

/** Intervjuns fas. Äldre dokument utan fältet härleds ur det som finns; fasen skrivs först vid nästa övergång. */
export function fasAv(a: Arende): Fas {
  if (a.fas) return a.fas;
  const sista = a.inlamningar[a.inlamningar.length - 1];
  if (sista && !andratEfter(a, sista)) return 'inlamnat';
  if (a.fragor.length === 0 && a.svar.length === 0) return 'intro';
  if (a.samtal_klar && !a.fragor.some((f) => f.status === 'stalld')) return 'avslut';
  return 'intervju';
}

export function sattFas(a: Arende, till: Fas, av: FasByte['av']) {
  const fran = a.fas ?? null;
  if (fran === till) return;
  a.fas = till;
  (a.fas_historik ??= []).push({ fran, till, tid: nu(), revision: a.revision, av });
  if (a.fas_historik.length > 100) a.fas_historik.splice(0, a.fas_historik.length - 100);
  handelse(a, 'fas', { fran, till, av });
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
    ai: { lage: p.ai || aiLageStandard(), anrop: 0, tokens_in: 0, tokens_out: 0, fel: 0, kostnad_usd: 0, okand_kostnad_usd: 0 },
    omgang: 0,
    inlamningar: [],
    handelser: [],
    uppgifter: [],
    tillval: [],
    research: [],
    tackning_agent: [],
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
  avsnitt: 'mal' | 'verksamhet';
  citat?: string;
}

const MAL_NYCKLAR = new Set(['verksamhetsmal', 'bra_forfragan']);

function omradeFor(a: Arende, nyckel: string, standard = ''): string {
  const tacker = (a.uppgifter || []).filter((u) => u.nyckel === nyckel && u.tacker && u.tacker !== nyckel).at(-1)?.tacker;
  return a.fragor.find((f) => f.nyckel === nyckel)?.omrade || a.fakta_forifyllda.find((f) => f.nyckel === nyckel)?.omrade || BANK.grund.find((g) => g.nyckel === nyckel)?.omrade || (tacker ? BANK.grund.find((g) => g.nyckel === tacker)?.omrade : '') || standard;
}

/**
 * Vår bild av kunden: per nyckel gäller kundens senaste besked (svar, rättelse eller kundens egna ord som agenten
 * noterat med ordagrant citat) före AI:ns tolkning före det förifyllda. Rättelse vinner vid samma revision.
 */
export function bild(a: Arende): BildRad[] {
  const rader = new Map<string, BildRad>();
  const avsnitt = (nyckel: string): 'mal' | 'verksamhet' => MAL_NYCKLAR.has(nyckel) || (a.uppgifter || []).some((u) => u.nyckel === nyckel && u.avsnitt === 'mal') ? 'mal' : 'verksamhet';
  const rubrikFor = (nyckel: string) => (a.uppgifter || []).filter((u) => u.nyckel === nyckel).at(-1)?.rubrik && !BANK.grund.some((g) => g.nyckel === nyckel) ? (a.uppgifter || []).filter((u) => u.nyckel === nyckel).at(-1)!.rubrik : rubrik(nyckel);
  for (const f of a.fakta_forifyllda) {
    if (f.status === 'okänt') continue;
    rader.set(f.nyckel, { nyckel: f.nyckel, rubrik: rubrikFor(f.nyckel), omrade: f.omrade, varde: f.varde, typ: 'forifylld', status: f.status, kalla: f.kalla, tid: f.datum, avsnitt: avsnitt(f.nyckel) });
  }
  const tolkningar = [
    ...a.fakta_ai.filter((f) => f.giltig).map((f) => ({ nyckel: f.nyckel, varde: f.varde, omrade: f.omrade, kalla: f.kalla, tid: f.datum, rev: f.bas_revision, citat: undefined as string | undefined })),
    ...(a.uppgifter || []).filter((u) => u.giltig && u.status === 'tolkning').map((u) => ({ nyckel: u.nyckel, varde: u.varde, omrade: omradeFor(a, u.nyckel, u.avsnitt === 'mal' ? 'A' : ''), kalla: `vår tolkning av ${u.kalla_typ === 'svar' ? 'ert svar' : 'ert material'}`, tid: u.tid, rev: u.revision, citat: u.citat })),
  ].sort((x, y) => x.rev - y.rev);
  for (const t of tolkningar) rader.set(t.nyckel, { nyckel: t.nyckel, rubrik: rubrikFor(t.nyckel), omrade: t.omrade || rader.get(t.nyckel)?.omrade || '', varde: t.varde, typ: 'ai', status: 'tolkning', kalla: t.kalla, tid: t.tid, avsnitt: avsnitt(t.nyckel), citat: t.citat });
  const kund = new Map<string, { varde: string; tid: string; rev: number; fraga_id?: string; kalla: string; citat?: string }>();
  const lagg = (nyckel: string, v: { varde: string; tid: string; rev: number; fraga_id?: string; kalla: string; citat?: string }) => {
    const b = kund.get(nyckel);
    if (!b || b.rev <= v.rev) kund.set(nyckel, v);
  };
  for (const s of a.svar) if (s.nyckel !== AVSLUT_FRAGA.nyckel) lagg(s.nyckel, { varde: s.typ === 'vet_inte' ? 'Vet inte – behöver följas upp' : s.text, tid: s.mottaget, rev: s.revision, fraga_id: s.fraga_id, kalla: 'kundens svar ' + s.fraga_id });
  for (const u of a.uppgifter || []) if (u.giltig && u.status === 'kunden uppger') lagg(u.nyckel, { varde: u.varde, tid: u.tid, rev: u.kalla_revision + 0.25, fraga_id: u.kalla_typ === 'svar' ? u.kalla_id : undefined, kalla: u.kalla_typ === 'svar' ? 'era ord i samtalet' : 'ert material', citat: u.citat });
  for (const r of a.rattelser) lagg(r.nyckel, { varde: r.varde, tid: r.mottaget, rev: r.revision + 0.5, kalla: 'kundens rättelse' });
  for (const [nyckel, k] of kund) {
    const omrade = rader.get(nyckel)?.omrade || omradeFor(a, nyckel, avsnitt(nyckel) === 'mal' ? 'A' : '');
    rader.set(nyckel, { nyckel, rubrik: rubrikFor(nyckel), omrade, varde: k.varde, typ: 'kund', status: 'kunden uppger', kalla: k.kalla, tid: k.tid, fraga_id: k.fraga_id, avsnitt: avsnitt(nyckel), citat: k.citat });
  }
  return [...rader.values()].sort((x, y) => x.omrade.localeCompare(y.omrade) || x.rubrik.localeCompare(y.rubrik, 'sv'));
}

function kandaNycklar(a: Arende): Set<string> {
  const s = new Set<string>();
  for (const f of a.fakta_forifyllda) if (f.status !== 'okänt') s.add(f.nyckel);
  for (const f of a.fakta_ai) if (f.giltig) s.add(f.nyckel);
  for (const x of a.svar) s.add(x.nyckel);
  for (const r of a.rattelser) s.add(r.nyckel);
  for (const u of a.uppgifter || []) if (u.giltig) s.add(u.nyckel);
  for (const m of a.tackning_agent || []) if (m.giltig) s.add(m.nyckel);
  for (const r of a.research || []) if (r.nyckel) s.add(r.nyckel);
  return s;
}

export interface Kandidat {
  id: string;
  omrade: string;
  nyckel: string;
  text: string;
  paverkar: string;
  prio: number;
  foljd: boolean;
  utlost_av?: string;
  senare?: boolean;
}

/** Den regelstyrda reservvägens kandidater: öppna behov, följdregler, sedan bankens luckor i prioritetsordning. */
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

/** Viktiga områden som återstår (prio 1 utan besked) och övriga luckor. Ingen procent, ingen tid. */
/**
 * Täckningsstödets områden som ingen har berört än. Behov som kunden själv tagit upp och Digitalas returfrågor räknas
 * inte här: de är redan nämnda och har egna frågor i samtalet (och egen status i exporten).
 */
export function aterstar(a: Arende): { viktiga: number; ovriga: number } {
  const grund = new Set(BANK.grund.map((g) => g.nyckel));
  // Nycklar som intervjuaren markerat som täckta i en tur räknas inte som orörda (exportens täckning rörs inte).
  const tackta = new Set((a.berorda || []).filter((b) => b.lage === 'tackt').map((b) => b.nyckel));
  const t = tackning(a).filter((x) => x.status === 'inte_undersokt' && grund.has(x.nyckel) && !tackta.has(x.nyckel));
  return { viktiga: t.filter((x) => x.prio === 1).length, ovriga: t.filter((x) => x.prio > 1).length };
}

/** Avrundning tillåts när inga viktiga områden står orörda och minst MINST_FRAGOR frågor ställts, eller vid frågegränsen. */
export function farAvrunda(a: Arende): boolean {
  const n = agentFragor(a);
  return n >= AVSLUT_EFTER_FRAGOR || (n >= MINST_FRAGOR && aterstar(a).viktiga === 0);
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

function tillvalSammanfattning(a: Arende, ids: string[]): string {
  const namn: Record<TillvalKundval, string> = { onskat: 'vill ha', har_system: 'har redan system', hjalp: 'vill ha hjälp att välja', inte_nu: 'inte nu' };
  return ids.map((id) => {
    const t = (a.tillval || []).find((x) => x.id === id);
    const def = TILLVAL_IDS.has(id) ? id : '';
    return `${def || id}: ${t?.kundval ? namn[t.kundval] + (t.system ? ` (${t.system})` : '') : 'inget val'}`;
  }).join('; ');
}

export async function registreraSvar(id: string, p: { fraga_id: string; text: string; typ: Svar['typ']; idempotens: string }): Promise<{ a: Arende; ny: boolean }> {
  const text0 = (p.typ === 'vet_inte' ? 'Vet inte' : String(p.text || '')).replace(/\r\n/g, '\n').trim();
  // Ett helt svar som bara säger "vet inte" är ett ärligt okänt, också när det skrivs i ord i stället för med en knapp.
  const typ: Svar['typ'] = p.typ === 'text' && text0.length <= 40 && VET_INTE_HELT.test(text0) ? 'vet_inte' : p.typ;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.idempotens)) throw new Vagrad('idempotensnyckel saknas');
  if (text0.length > MAX_SVAR_TECKEN) throw new Vagrad(`svaret är längre än ${MAX_SVAR_TECKEN} tecken`);
  if (serUtSomHemlighet(text0)) throw new Vagrad('svaret ser ut att innehålla ett lösenord eller en nyckel; ta bort det, så ordnar vi åtkomst på säker väg', 422);
  let ny = false;
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    ny = false;
    if (a.svar.some((s) => s.idempotens === p.idempotens)) return null;
    const f = a.fragor.find((x) => x.id === p.fraga_id);
    if (!f) throw new Vagrad('frågan finns inte i ärendet', 404);
    let text = text0;
    // Tillvalsfrågan besvaras med kundens egna val i kontrollerna; texten sammanställs av servern ur det sparade läget
    // (inte ur klientens påstående), med kundens eventuella kommentar ordagrant efter.
    if (f.typ === 'tillval' && typ === 'val') text = 'Val i kontrollerna: ' + tillvalSammanfattning(a, f.tillval || []) + (text0 ? '\nKommentar: ' + text0 : '');
    else if (typ !== 'vet_inte' && !text) throw new Vagrad('svaret är tomt');
    if (f.typ === 'val' && typ === 'val' && !(f.alternativ || []).includes(text)) throw new Vagrad('okänt alternativ');
    const tidigare = [...a.svar].reverse().find((x) => x.fraga_id === f.id);
    // Samma text igen (annan flik, återförsök, dubbelklick med ny nyckel): ingen ny rad. Annan text på en redan
    // besvarad fråga: ett ändrat svar som ersätter det förra synligt, aldrig en dubblett.
    if (tidigare && tidigare.text === text && tidigare.typ === typ) return null;
    if (tidigare && Date.now() - new Date(tidigare.mottaget).getTime() < MIN_MS_MELLAN_SVAR && tidigare.text === text) return null;
    const fasFore = fasAv(a); // före svaret: efteråt räknas svaret som en ändring efter inlämningen
    bump(a);
    const s: Svar = { fraga_id: f.id, nyckel: f.nyckel, omrade: f.omrade, text, typ, mottaget: nu(), revision: a.revision, idempotens: p.idempotens, ersatter: tidigare ? tidigare.revision : undefined };
    const rad = bild(a).find(b => b.nyckel === 'erbjudande');
    a.svar.push(s);
    f.status = 'besvarad';
    if (f.roll !== 'avslut') {
      // Ett nytt kundsvar öppnar ett avslutat samtal igen: intervjuaren får ta ställning till det nya. Sista tankar på
      // avslutsfrågan gör det inte: samtalet förblir avslutat och sammanfattningen tar med svaret.
      if (a.samtal_klar) a.samtal_klar = null;
      if (a.syntes && a.syntes.status === 'klar') a.syntes.status = 'inaktuell';
      const andraOppna = a.fragor.some((x) => x.status === 'stalld' && x.id !== f.id);
      // Returfrågor och åter öppnade frågor efter en sammanfattning: tillbaka till granskningen när inget mer står öppet.
      if (a.syntes && !andraOppna && (f.kalla === 'returfraga' || f.oppnad_revision !== undefined || fasFore === 'granskning' || fasFore === 'inlamnat')) sattFas(a, 'granskning', 'kund');
      else if (fasFore !== 'intervju') sattFas(a, 'intervju', 'kund');
    }
    const behov = a.behov?.find(b => b.id === f.id);
    if (behov) behov.status = typ === 'vet_inte' || typ === 'atkomst_saknas' ? 'oppen' : 'besvarad';
    if (behov && (typ === 'vet_inte' || typ === 'atkomst_saknas')) f.status = 'senare';
    samlaBehov(a, s, rad ? {varde:rad.varde,kalla:rad.kalla,typ:rad.typ === 'kund' ? 'svar' : rad.typ} : undefined);
    signalera(a);
    for (const t of a.fakta_ai) if (t.nyckel === f.nyckel && t.giltig) { t.giltig = false; t.forkastad_skal = 'kundens senare svar ' + f.id; }
    for (const u of a.uppgifter || []) if (u.nyckel === f.nyckel && u.giltig && u.status === 'tolkning') { u.giltig = false; u.forkastad_skal = 'kundens senare svar ' + f.id; }
    if (typ !== 'vet_inte') {
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
    handelse(a, 'svar', { fraga_id: f.id, typ: typ, tecken: text.length });
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
    if (a.samtal_klar) a.samtal_klar = null;
    sattFas(a, 'intervju', 'kund');
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
    if (!rad && !a.fragor.some((f) => f.nyckel === p.nyckel) && !BANK.grund.some((g) => g.nyckel === p.nyckel)) throw new Vagrad('uppgiften finns inte i er bild', 404);
    if (rad && rad.varde === varde) return null;
    bump(a);
    const tidigare: Rattelse['tidigare'] = rad ? { varde: rad.varde, kalla: rad.kalla, typ: rad.typ === 'kund' ? 'svar' : rad.typ } : { varde: '', kalla: '', typ: 'ingen' };
    a.rattelser.push({ nyckel: p.nyckel, varde, mottaget: nu(), revision: a.revision, idempotens: p.idempotens, tidigare });
    for (const b of a.behov || []) if (b.nyckel === p.nyckel) { b.status = 'besvarad'; const f = a.fragor.find(f => f.id === b.id); if (f) f.status = 'besvarad'; }
    for (const t of a.fakta_ai) if (t.nyckel === p.nyckel && t.giltig) { t.giltig = false; t.forkastad_skal = 'kundens rättelse'; }
    for (const u of a.uppgifter || []) if (u.nyckel === p.nyckel && u.giltig && u.status === 'tolkning') { u.giltig = false; u.forkastad_skal = 'kundens rättelse rev ' + a.revision; }
    for (const m of a.tackning_agent || []) if (m.nyckel === p.nyckel && m.giltig) { m.giltig = false; }
    signalera(a);
    aktualiseraOkant(a);
    handelse(a, 'rattelse', { nyckel: p.nyckel, tidigare: tidigare.typ });
    ny = true;
    return a;
  });
  return { a: r.data, ny };
}

// ---------- tillval ----------

function tillvalRad(a: Arende, id: string): Tillval {
  a.tillval ??= [];
  let t = a.tillval.find((x) => x.id === id);
  if (!t) {
    t = { id, kundval: null, revision: 0, historik: [] };
    a.tillval.push(t);
  }
  return t;
}

/**
 * Kundens eget val i kontrollerna ("Lägg till", "Vi har redan ett system", "Hjälp mig välja", "Inte nu", eller ångra).
 * Ett annat behov kan beskrivas med egna ord. Samma handling igen ger ingen ny rad.
 */
export async function sattTillval(id: string, p: { tillval: string; kundval: TillvalKundval | null; system?: string; beskrivning?: string; not?: string; idempotens: string }): Promise<{ a: Arende; ny: boolean; tillval: string }> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.idempotens)) throw new Vagrad('idempotensnyckel saknas');
  const kundval = p.kundval;
  if (kundval !== null && !['onskat', 'har_system', 'hjalp', 'inte_nu'].includes(kundval)) throw new Vagrad('okänt val');
  const system = String(p.system || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const beskrivning = String(p.beskrivning || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const not = String(p.not || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (kundval === 'har_system' && !system) throw new Vagrad('skriv vilket system ni har, så tar vi hänsyn till det');
  for (const t of [system, beskrivning, not]) if (t && serUtSomHemlighet(t)) throw new Vagrad('texten ser ut att innehålla ett lösenord eller en nyckel; ta bort det, så ordnar vi åtkomst på säker väg', 422);
  if (p.tillval !== 'annat' && !TILLVAL_IDS.has(p.tillval) && !arAnnat(p.tillval)) throw new Vagrad('okänt tillval', 404);
  if (p.tillval === 'annat' && !beskrivning) throw new Vagrad('beskriv behovet med några ord');
  let ny = false;
  let tid = p.tillval;
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    ny = false;
    if ((a.tillval || []).some((t) => t.historik.some((h) => h.idempotens === p.idempotens))) return null;
    if (p.tillval === 'annat') {
      const annat = (a.tillval || []).filter((t) => arAnnat(t.id));
      const samma = annat.find((t) => t.beskrivning === beskrivning);
      if (samma) { tid = samma.id; if (samma.kundval === kundval) return null; }
      else {
        if (annat.length >= MAX_ANNAT) throw new Vagrad('högst åtta egna behov; ändra ett befintligt i stället', 422);
        tid = annatId(annat.length + 1);
      }
    } else if (arAnnat(p.tillval) && !(a.tillval || []).some((t) => t.id === p.tillval)) throw new Vagrad('okänt tillval', 404);
    const t = tillvalRad(a, tid);
    if (p.tillval === 'annat' && !t.beskrivning) t.beskrivning = beskrivning;
    if (t.kundval === kundval && (t.system || '') === (kundval === 'har_system' ? system : '') && (!not || t.not === not)) return null;
    bump(a);
    t.kundval = kundval;
    t.system = kundval === 'har_system' ? system : undefined;
    if (not) t.not = not;
    t.kalla = 'kontroll';
    t.citat = undefined;
    t.fraga_id = undefined;
    t.revision = a.revision;
    t.historik.push({ tid: nu(), revision: a.revision, kundval, system: t.system, not: not || undefined, kalla: 'kontroll', idempotens: p.idempotens });
    if (a.samtal_klar && kundval !== null) a.samtal_klar = { ...a.samtal_klar };
    signalera(a);
    handelse(a, 'tillval', { tillval: tid, kundval, kalla: 'kontroll' });
    ny = true;
    return a;
  });
  return { a: r.data, ny, tillval: tid };
}

/** Digitalas status för ett tillval (ingår i uppdraget, väntar på åtkomst, anslutet och prövat). Ändrar inte kundrevisionen. */
export async function sattTillvalDigitala(id: string, p: { tillval: string; status: TillvalDigitala | null; not: string; kalla: string; utforare: string; idempotens: string }) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.idempotens || '')) throw new Vagrad('idempotensnyckel saknas');
  if (!/^[a-zA-Z0-9_.@/-]{2,120}$/.test(p.utforare || '')) throw new Vagrad('utförare krävs');
  if (p.status !== null && !['inkluderat', 'vantar_atkomst', 'anslutet_provat'].includes(p.status)) throw new Vagrad('okänd status');
  const not = String(p.not || '').trim().slice(0, 400);
  const kalla = String(p.kalla || '').trim().slice(0, 300);
  if (!kalla) throw new Vagrad('källa krävs: vilket underlag statusen bygger på');
  if (serUtSomHemlighet(not + kalla)) throw new Vagrad('ingen hemlighet i status', 422);
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    if (!TILLVAL_IDS.has(p.tillval) && !(a.tillval || []).some((t) => t.id === p.tillval)) throw new Vagrad('okänt tillval', 404);
    const t = tillvalRad(a, p.tillval);
    if (t.digitala?.idempotens === p.idempotens) return null;
    t.digitala = p.status ? { status: p.status, not, kalla, utforare: p.utforare, tid: nu(), idempotens: p.idempotens } : null;
    handelse(a, 'tillval_digitala', { tillval: p.tillval, status: p.status, utforare: p.utforare });
    return a; // administrativ status: ingen ny kundrevision och ingen ny signal
  });
  return r.data;
}

/**
 * Domänflödet: kunden anger en befintlig eller önskad domän; servern läser öppna uppgifter (DNS/RDAP, se doman.ts) och
 * sparar valet och den daterade kontrollen i samma ärende. Ingenting köps eller ändras hos kundens leverantör.
 */
export async function sattDoman(id: string, p: { doman: string; kundval: 'har_system' | 'onskat'; idempotens: string }): Promise<{ a: Arende; ny: boolean; kontroll: DomanKontroll }> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.idempotens)) throw new Vagrad('idempotensnyckel saknas');
  if (p.kundval !== 'har_system' && p.kundval !== 'onskat') throw new Vagrad('okänt val');
  const doman = normaliseraDoman(p.doman);
  if (!doman) throw new Vagrad('skriv domänen som till exempel dittforetag.se');
  const fore = await lasArende(id);
  if (!fore) throw new Vagrad('ärendet finns inte', 404);
  const t0 = (fore.tillval || []).find((t) => t.id === 'doman');
  if (t0?.kontroll && t0.historik.some((h) => h.idempotens === p.idempotens)) return { a: fore, ny: false, kontroll: t0.kontroll };
  // Samma domän och samma val igen (dubbelklick, ny flik med ny nyckel): ingen ny kontroll och ingen ny historikrad.
  if (t0?.kontroll && !t0.kontroll.fel && t0.kundval === p.kundval && t0.system === doman && t0.kalla === 'kontroll') return { a: fore, ny: false, kontroll: t0.kontroll };
  const senaste = fore.handelser.filter((h) => h.typ === 'doman_kontroll' && Date.now() - Date.parse(h.tid) < 3600_000).length;
  if (senaste >= MAX_DOMANKONTROLLER_PER_TIMME) throw new Vagrad('för många domänkontroller den senaste timmen; försök igen om en stund', 429);
  const kontroll = await kontrolleraDoman(doman);
  let ny = false;
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    ny = false;
    const t = tillvalRad(a, 'doman');
    if (t.historik.some((h) => h.idempotens === p.idempotens)) return null;
    if (t.kontroll && !t.kontroll.fel && t.kundval === p.kundval && t.system === doman && t.kalla === 'kontroll') return null;
    bump(a);
    t.kundval = p.kundval;
    t.system = doman;
    t.kalla = 'kontroll';
    t.citat = undefined;
    t.fraga_id = undefined;
    t.revision = a.revision;
    t.kontroll = kontroll;
    t.historik.push({ tid: nu(), revision: a.revision, kundval: p.kundval, system: doman, kalla: 'kontroll', idempotens: p.idempotens });
    signalera(a);
    handelse(a, 'doman_kontroll', { doman, registrerad: kontroll.registrerad, kalla: kontroll.kalla_registrering, fel: kontroll.fel });
    ny = true;
    return a;
  });
  return { a: r.data, ny, kontroll };
}

/** När agenten har noterat kundens domän i samtalet kontrolleras den på samma sätt, en gång per domän. */
async function efterkontrolleraDoman(a: Arende): Promise<Arende> {
  const t = (a.tillval || []).find((x) => x.id === 'doman');
  if (!t || !t.system || (t.kundval !== 'har_system' && t.kundval !== 'onskat')) return a;
  const doman = normaliseraDoman(t.system.split(/[\s,;()]+/).find((w) => w.includes('.')) || t.system);
  if (!doman || t.kontroll?.doman === doman) return a;
  if (a.handelser.filter((h) => h.typ === 'doman_kontroll' && Date.now() - Date.parse(h.tid) < 3600_000).length >= MAX_DOMANKONTROLLER_PER_TIMME) return a;
  const kontroll = await kontrolleraDoman(doman);
  const r = await uppdateraDok<Arende>(arendeStig(a.id), (x) => {
    const tt = (x.tillval || []).find((y) => y.id === 'doman');
    if (!tt || tt.revision !== t.revision || tt.kontroll?.doman === doman) return null;
    tt.kontroll = kontroll; // härledd observation: ingen ny kundrevision
    handelse(x, 'doman_kontroll', { doman, registrerad: kontroll.registrerad, kalla: kontroll.kalla_registrering, fel: kontroll.fel, utlost_av: 'samtal' });
    return x;
  });
  return r.data;
}

// ---------- agentens tur ----------

/** Ordlikhet (Jaccard över ord ≥ 3 tecken) för att känna igen samma researchbeställning i nya ord. */
function likhet(x: string, y: string): number {
  const ord = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
  const a = ord(x), b = ord(y);
  if (!a.size || !b.size) return 0;
  let gemensamt = 0;
  for (const w of a) if (b.has(w)) gemensamt++;
  return gemensamt / (a.size + b.size - gemensamt);
}

/** Öppningsfrågan är fast: kunden börjar berätta direkt, utan att vänta på ett modellsvar. */
export const OPPNING = { id: 'AG1', nyckel: 'verksamhetsmal', omrade: 'A', text: 'Berätta med egna ord: vad gör ni, och vad vill ni att webbplatsen ska hjälpa er med?', paverkar: 'vad webbplatsen ska åstadkomma och vilka frågor som behövs sedan' };

export interface NastaResultat {
  a: Arende;
  fragor: Fraga[];
  klar: boolean;
  meddelande: string;
  vantar?: boolean;
  forkastad?: boolean;
  ai: { lage: AiLage; anvand: boolean; fallback: boolean; fel?: string; modell?: string; ms?: number; kostnad_usd?: number | null };
}

function agentFragor(a: Arende): number {
  return a.fragor.filter((f) => f.status !== 'tackt').length;
}

/** Tillämpar en intervjutur: berörda nycklar, nästa fråga med återkoppling, eller avrundningen. Körs inuti en villkorad skrivning. */
function tillampaTur(a: Arende, ut: TurUtdata, opts: { avsluta?: boolean } = {}): { fraga: string | null; klar: boolean; berorda: number } {
  let berorda = 0;
  const sista = a.svar[a.svar.length - 1];
  for (const b of ut.berorda) {
    const lista = (a.berorda ??= []);
    const x = lista.find((y) => y.nyckel === b.nyckel);
    if (x) {
      if (x.lage === 'berord' && b.lage === 'tackt') { x.lage = 'tackt'; x.fraga_id = sista?.fraga_id || x.fraga_id; x.revision = a.revision; berorda++; }
      continue;
    }
    lista.push({ nyckel: b.nyckel, lage: b.lage, fraga_id: sista?.fraga_id || '', revision: a.revision });
    berorda++;
  }
  // Avslut godtas när inga viktiga områden står orörda (och samtalet inte är alldeles kort), vid frågegränsen, eller på kundens begäran.
  const klar = Boolean(opts.avsluta) || (ut.klar && farAvrunda(a));
  let fraga: string | null = null;
  if (klar) {
    fraga = stangSamtal(a, { meddelande: ut.aterkoppling, fragetext: ut.fraga?.text, valjare: 'ai' });
  } else if (ut.fraga && ut.fraga.nyckel !== AVSLUT_FRAGA.nyckel) {
    const n = nastaAgNr(a);
    a.omgang += 1;
    const f: Fraga = { id: `AG${n}`, omrade: ut.fraga.omrade, nyckel: ut.fraga.nyckel, text: ut.fraga.text, paverkar: ut.fraga.varfor || 'förståelsen av uppdraget', kalla: 'agent', typ: 'oppen', inledning: ut.aterkoppling || undefined, utlost_av: ut.fraga.behov_id ? `behov ${ut.fraga.behov_id}` : null, omgang: a.omgang, stalld: nu(), status: 'stalld', valjare: 'ai' };
    a.fragor.push(f);
    fraga = f.id;
  }
  return { fraga, klar, berorda };
}

/** Tillämpar syntesens validerade noteringar i ärendet (kundens ord, behov, tillval, täckning, research). Körs inuti en villkorad skrivning. */
function tillampaSyntes(a: Arende, ut: SyntesUtdata, bas: number, modell?: string): { nyaUppgifter: number; tillval: number; rek: number; tackning: number; research: number; behov: number } {
  const rev = a.revision;
  const rattadEfter = (nyckel: string, r: number) => a.rattelser.some((x) => x.nyckel === nyckel && x.revision > r);
  let nyaUppgifter = 0;
  for (const [ix, u] of ut.uppgifter.entries()) {
    if (rattadEfter(u.nyckel, u.kalla_revision)) continue;
    // Ett helt svar under frågans egen nyckel står redan som kundens svar; samma värde under en annan nyckel är en dubblett.
    const kallSvar = u.kalla_typ === 'svar' ? [...a.svar].reverse().find((s) => s.fraga_id === u.kalla_id) : undefined;
    if (kallSvar && kallSvar.nyckel === u.nyckel && kallSvar.text.trim() === u.varde.trim()) continue;
    if (u.status === 'kunden uppger' && (a.uppgifter || []).some((x) => x.giltig && x.varde === u.varde && x.nyckel !== u.nyckel)) continue;
    const lista = (a.uppgifter ??= []);
    if (lista.some((x) => x.giltig && x.nyckel === u.nyckel && x.varde === u.varde && x.status === u.status)) continue;
    for (const x of lista) if (x.giltig && x.nyckel === u.nyckel && x.status === u.status) { x.giltig = false; x.forkastad_skal = `ersatt av U${rev}_${ix + 1}`; }
    lista.push({ id: `U${rev}_${ix + 1}`, nyckel: u.nyckel, rubrik: u.rubrik, avsnitt: u.avsnitt, status: u.status, varde: u.varde, citat: u.citat, kalla_typ: u.kalla_typ, kalla_id: u.kalla_id, kalla_revision: u.kalla_revision, bas_revision: bas, revision: rev, tid: nu(), giltig: true, modell, tacker: u.tacker });
    nyaUppgifter++;
  }
  let behov = 0;
  for (const b of ut.behov) {
    const s = [...a.svar].reverse().find((x) => x.fraga_id === b.kalla_id);
    const fore = a.behov?.length || 0;
    if (s) laggBehov(a, { nyckel: b.nyckel, citat: b.citat, fraga: b.fraga }, s, 'ai');
    if ((a.behov?.length || 0) > fore) behov++;
  }
  let tillval = 0;
  for (const v of ut.tillval_val) {
    const t = tillvalRad(a, v.tillval);
    // Ett äldre uttalande i samtalet får aldrig ändra ett nyare val som kunden gjort i kontrollerna.
    if (t.revision > v.kalla_revision) continue;
    if (t.kundval === v.kundval && (t.system || '') === (v.kundval === 'har_system' ? v.system : '')) continue;
    t.kundval = v.kundval;
    t.system = v.kundval === 'har_system' ? v.system : undefined;
    t.kalla = 'samtal';
    t.citat = v.citat;
    t.fraga_id = v.kalla_id;
    t.revision = rev;
    t.historik.push({ tid: nu(), revision: rev, kundval: v.kundval, system: t.system, kalla: 'samtal', fraga_id: v.kalla_id, citat: v.citat });
    tillval++;
  }
  let rek = 0;
  for (const r of ut.tillval_rekommendation) {
    const t = tillvalRad(a, r.tillval);
    if (t.kundval && t.kundval !== 'hjalp') continue; // kunden har redan tagit ställning
    if (t.rekommendation?.giltig && t.rekommendation.text === r.motivering) continue;
    t.rekommendation = { text: r.motivering, bas_revision: bas, revision: rev, tid: nu(), modell, giltig: true };
    rek++;
  }
  let tack = 0;
  for (const m of ut.tackning) {
    const senareSvar = a.svar.some((s) => s.nyckel === m.nyckel && s.revision > m.kalla_revision && s.typ !== 'vet_inte');
    if (senareSvar || rattadEfter(m.nyckel, m.kalla_revision)) continue;
    // En markering (vet inte, gäller inte, avstår) ur ett annat svar får aldrig ersätta det kunden själv sagt om nyckeln.
    const kundensEgna = a.svar.some((s) => s.nyckel === m.nyckel && s.typ !== 'vet_inte') || a.rattelser.some((r) => r.nyckel === m.nyckel)
      || (a.uppgifter || []).some((u) => u.giltig && u.status === 'kunden uppger' && (u.nyckel === m.nyckel || u.tacker === m.nyckel));
    if (kundensEgna) continue;
    const lista = (a.tackning_agent ??= []);
    if (lista.some((x) => x.giltig && x.nyckel === m.nyckel && x.lage === m.lage)) continue;
    for (const x of lista) if (x.giltig && x.nyckel === m.nyckel) x.giltig = false;
    lista.push({ nyckel: m.nyckel, lage: m.lage, citat: m.citat, fraga_id: m.kalla_id, revision: m.kalla_revision, tid: nu(), giltig: true });
    tack++;
  }
  let research = 0;
  for (const r of ut.research) {
    const lista = (a.research ??= []);
    if (lista.length >= MAX_RESEARCH) break;
    if (lista.some((x) => (r.nyckel && x.nyckel === r.nyckel) || likhet(x.fraga, r.fraga) >= 0.6)) continue;
    lista.push({ id: `R${rev}_${lista.length + 1}`, fraga: r.fraga, varfor: r.varfor, nyckel: r.nyckel || undefined, kalla_typ: r.kalla_typ, kalla_id: r.kalla_id, citat: r.citat, status: 'bestalld', revision: rev, tid: nu(), modell });
    research++;
  }
  if (nyaUppgifter + tillval + tack + research > 0) signalera(a);
  return { nyaUppgifter, tillval, rek, tackning: tack, research, behov };
}

function nastaAgNr(a: Arende): number {
  return Math.max(0, ...a.fragor.filter((f) => /^AG\d+$/.test(f.id)).map((f) => Number(f.id.slice(2)))) + 1;
}

/** Avslutar samtalet: avslutsmeddelandet och avslutsfrågan (sista tankar) blir sista turen, fasen blir avslut. */
function stangSamtal(a: Arende, p: { meddelande: string; fragetext?: string; valjare: 'ai' | 'regelstyrd' | 'kund' }): string {
  a.samtal_klar = { revision: a.revision, tid: nu(), meddelande: p.meddelande, valjare: p.valjare };
  const text = (p.fragetext || '').replace(/\s+/g, ' ').trim().slice(0, 400) || AVSLUT_FRAGA.text;
  const n = nastaAgNr(a);
  a.omgang += 1;
  const f: Fraga = { id: `AG${n}`, roll: 'avslut', omrade: AVSLUT_FRAGA.omrade, nyckel: AVSLUT_FRAGA.nyckel, text, paverkar: AVSLUT_FRAGA.paverkar, kalla: 'agent', typ: 'oppen', inledning: p.meddelande || undefined, omgang: a.omgang, stalld: nu(), status: 'stalld', valjare: p.valjare === 'ai' ? 'ai' : 'regelstyrd' };
  a.fragor.push(f);
  sattFas(a, 'avslut', p.valjare);
  return f.id;
}

const OMRADEN_LAGT: Record<string, string> = { A: 'verksamheten och erbjudandet', B: 'besökarna', C: 'hur ni arbetar', D: 'system och åtkomster', E: 'uttryck och innehåll', F: 'synlighet och mätning', G: 'förvaltningen', H: 'ramarna' };

/** Standardlistans avslutsmeddelande: fast text ur ärendets egna tal, inga löften. */
function avslutstextRegelstyrd(a: Arende): string {
  const besvarade = new Set(a.svar.map((s) => s.fraga_id));
  const fragor = a.fragor.filter((f) => besvarade.has(f.id) && f.roll !== 'avslut');
  const n = fragor.length;
  const omraden = [...new Set(fragor.map((f) => OMRADEN_LAGT[f.omrade]).filter(Boolean))].slice(0, 3);
  const om = omraden.length ? ' om ' + (omraden.length > 1 ? omraden.slice(0, -1).join(', ') + ' och ' + omraden[omraden.length - 1] : omraden[0]) : '';
  const oppna = aterstar(a).viktiga > 0 ? 'Några områden står fortfarande öppna; de visas i sammanfattningen och kan kompletteras senare. ' : '';
  return `Tack. Ni har svarat på ${n} ${n === 1 ? 'fråga' : 'frågor'}${om}. ${oppna}Nu sammanställer vi det ni berättat så att ni kan läsa igenom det.`;
}

export interface TranskriptRad { fraga_id: string; roll: 'oppning' | 'fraga' | 'avslut'; inledning?: string; fraga: string; stalld: string; valjare: 'regelstyrd' | 'ai'; status: string; svar: { text: string; typ: string; tid: string; andrad: number } | null }

/** Hela intervjun i ordning, ordagrant: intervjuarens tur (återkoppling och fråga) och kundens svar. */
export function transkript(a: Arende): TranskriptRad[] {
  return a.fragor.filter((f) => f.status !== 'tackt' || f.roll === 'avslut').map((f) => {
    const svar = a.svar.filter((s) => s.fraga_id === f.id);
    const s = svar[svar.length - 1];
    return { fraga_id: f.id, roll: f.roll || 'fraga', inledning: f.inledning, fraga: f.text, stalld: f.stalld, valjare: f.valjare, status: f.status, svar: s ? { text: s.text, typ: s.typ, tid: s.mottaget, andrad: svar.length - 1 } : null };
  });
}

function kortText(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Deterministisk sammanställning utan modell: kundens svar ordagrant under bankens rubriker, och det som återstår. */
export function syntesRegelstyrd(a: Arende): Pick<Syntes, 'sammanfattning' | 'nyckelinsikt' | 'oppet'> {
  const ordning = [...BANK.grund].sort((x, y) => x.prio - y.prio || x.id.localeCompare(y.id)).map((g) => g.nyckel);
  const senaste = new Map<string, Svar>();
  for (const s of a.svar) if (s.typ === 'text' || s.typ === 'val') senaste.set(s.nyckel, s);
  const rader: string[] = [];
  for (const nyckel of [...ordning, ...[...senaste.keys()].filter((k) => !ordning.includes(k) && k !== AVSLUT_FRAGA.nyckel)]) {
    const s = senaste.get(nyckel);
    if (!s || rader.length >= 6) continue;
    rader.push(`${rubrik(nyckel)}: ”${kortText(s.text, 300)}”`);
  }
  const sista = senaste.get(AVSLUT_FRAGA.nyckel);
  if (sista) rader.push(`Ert tillägg: ”${kortText(sista.text, 300)}”`);
  const paverkar = new Map(BANK.grund.map((g) => [g.nyckel, g.paverkar.replace(/\s*\([^)]*\)/g, '').replace(/\s*;.*$/, '').trim()]));
  const oppet = tackning(a).filter((t) => t.status === 'inte_undersokt' || t.status === 'kunden_vet_inte' || t.status === 'aterkom_senare').sort((x, y) => x.prio - y.prio).slice(0, 8).map((t) => ({ nyckel: t.nyckel, varfor: paverkar.get(t.nyckel) || t.fraga }));
  return { sammanfattning: ['Det ni berättat, i era egna ord:', ...rader].join('\n\n'), nyckelinsikt: '', oppet };
}

function skrivSyntes(a: Arende, d: Pick<Syntes, 'sammanfattning' | 'nyckelinsikt' | 'oppet'>, meta: { valjare: Syntes['valjare']; bas_revision: number; modell?: string; anstrangning?: string; ms?: number; avvisade?: number }) {
  a.syntes = { id: `S${a.revision}`, status: 'klar', bas_revision: meta.bas_revision, revision: a.revision, tid: nu(), valjare: meta.valjare, modell: meta.modell, anstrangning: meta.anstrangning, ms: meta.ms, forsok: (a.syntes?.status === 'misslyckad' ? a.syntes.forsok : 0) + 1, sammanfattning: d.sammanfattning, nyckelinsikt: d.nyckelinsikt, oppet: d.oppet, avvisade: meta.avvisade };
}

/** Reservvägen: nästa fråga ur Digitalas standardlista (behov, följdregler, luckor); rundar av med samma regel som intervjuaren. */
function tillampaRegelstyrd(a: Arende, inledning?: string): string | null {
  const k = kandidater(a).find((x) => !x.senare);
  if (!k || farAvrunda(a)) return stangSamtal(a, { meddelande: avslutstextRegelstyrd(a), valjare: 'regelstyrd' });
  const senare = a.fragor.find((f) => f.id === k.id && f.status === 'senare');
  if (senare) a.fragor.splice(a.fragor.indexOf(senare), 1);
  a.omgang += 1;
  a.fragor.push({ id: k.id, omrade: k.omrade, nyckel: k.nyckel, text: k.text, paverkar: k.paverkar, utlost_av: k.utlost_av ?? null, kalla: k.id.startsWith('BEH') ? 'behov' : 'bank', typ: 'oppen', omgang: a.omgang, stalld: nu(), status: 'stalld', valjare: 'regelstyrd', inledning });
  return k.id;
}

interface Anropsutfall { svar: ModellSvar | null; fel?: ModellFel; forsok: number; tokens_in: number; tokens_out: number; kand_usd: number; okand_usd: number; ms: number; diagnostik: Record<string, unknown>[]; budgetStopp?: string }

/** Ett modellkontrakt: turen (liten, snabb) eller syntesen (stor, en gång). Samma transport, olika schema och budget. */
interface Kontrakt { slag: 'tur' | 'syntes'; system: string; anvandare: string; schema: object; schemaNamn: 'kundstart_tur' | 'kundstart_syntes'; maxTokens: number; omtagTokens: number; timeoutMs: number }

function turKontrakt(anvandare: string, prov: ProvVal | null): Kontrakt {
  return { slag: 'tur', system: turSystemText(), anvandare, schema: TUR_SCHEMA, schemaNamn: 'kundstart_tur', maxTokens: TUR_MAX_TOKENS, omtagTokens: TUR_MAX_TOKENS_OMTAG, timeoutMs: turTimeoutMs(prov?.anstrangning || 'low') };
}

function syntesKontrakt(anvandare: string): Kontrakt {
  return { slag: 'syntes', system: syntesSystemText(), anvandare, schema: SYNTES_SCHEMA, schemaNamn: 'kundstart_syntes', maxTokens: SYNTES_MAX_TOKENS, omtagTokens: SYNTES_MAX_TOKENS_OMTAG, timeoutMs: syntesTimeoutMs() };
}

async function korModell(a: Arende, lage: AiLage, modell: string, k: Kontrakt, prov: ProvVal | null): Promise<Anropsutfall> {
  const start = Date.now();
  const ut: Anropsutfall = { svar: null, forsok: 0, tokens_in: 0, tokens_out: 0, kand_usd: 0, okand_usd: 0, ms: 0, diagnostik: [] };
  let maxTokens = k.maxTokens;
  for (let n = 0; n < 2; n++) {
    // Gateway: turen har 45 s inom funktionens 60 s; andra försöket bara när minst 25 s återstår och felet går att försöka om.
    // claude -p: inget omtag för turen (standardlistan tar över), ett omtag för syntesen vid formfel (den är dyr att tappa).
    if (n > 0 && (lage === 'claude-cli' ? !(k.slag === 'syntes' && ut.fel?.klass === 'format') : Date.now() - start > TUR_MS - 25_000)) break;
    const tecken = k.system.length + k.anvandare.length;
    let res: { ok: true; id: string; usd: number } | null = null;
    if (lage === 'gateway') {
      const forbrukat = (a.ai.kostnad_usd || 0) + (a.ai.okand_kostnad_usd || 0) + ut.kand_usd + ut.okand_usd;
      const rr = await reservera(a.id, forbrukat, maxKostnad(modell, tecken, maxTokens));
      if (!rr.ok) { ut.budgetStopp = rr.skal; ut.diagnostik.push({ forsok: n + 1, budget: rr.tak, skal: rr.skal }); break; }
      res = rr;
    }
    ut.forsok++;
    try {
      const svar = lage === 'gateway'
        ? await viaGateway({ modell, system: k.system, anvandare: k.anvandare, schemaNamn: k.schemaNamn, schema: k.schema, maxTokens, timeoutMs: Math.min(40_000, Math.max(5_000, TUR_MS - (Date.now() - start))) })
        : await viaClaudeCli({ modell, system: k.system, anvandare: k.anvandare, schemaNamn: k.schemaNamn, schema: k.schema, maxTokens, timeoutMs: k.timeoutMs, anstrangning: prov?.anstrangning });
      const kostnad = svar.kostnad_usd ?? (lage === 'gateway' ? kostnadUrToken(modell, svar.tokens_in, svar.tokens_out) : null);
      if (res) await avrakna(res.id, kostnad, res.usd);
      ut.tokens_in += svar.tokens_in; ut.tokens_out += svar.tokens_out;
      if (kostnad !== null) ut.kand_usd += kostnad;
      ut.diagnostik.push({ forsok: n + 1, slag: k.slag, ...svar.diagnos, tokens_in: svar.tokens_in, tokens_out: svar.tokens_out, kostnad_usd: kostnad, ms: Date.now() - start });
      ut.svar = svar;
      break;
    } catch (e) {
      const f = e instanceof ModellFel ? e : new ModellFel('transport', false);
      const kostnad = f.kostnad_usd ?? (f.tokens_in || f.tokens_out ? kostnadUrToken(modell, f.tokens_in, f.tokens_out) : null);
      if (res) await avrakna(res.id, kostnad, res.usd);
      if (kostnad !== null) ut.kand_usd += kostnad; else if (res) ut.okand_usd += res.usd;
      ut.tokens_in += f.tokens_in; ut.tokens_out += f.tokens_out;
      ut.fel = f;
      ut.diagnostik.push({ forsok: n + 1, slag: k.slag, felklass: f.klass, ...f.diagnos, tokens_in: f.tokens_in, tokens_out: f.tokens_out, kostnad_usd: kostnad, ms: Date.now() - start });
      if (f.klass === 'avkortat') maxTokens = k.omtagTokens;
      const delay = Number(f.diagnos.retry_after || 0);
      if (!f.retry || delay > 2) break;
      if (delay) await new Promise((r) => setTimeout(r, Math.min(2000, delay * 1000)));
    }
  }
  ut.ms = Date.now() - start;
  return ut;
}

/** Bokför ett modellanrop i ärendet: antal, token, kostnad/listpris, fel i rad, paus och kvot. Körs inuti en villkorad skrivning. */
function bokforAnrop(a: Arende, utfall: Anropsutfall | null, lyckat: boolean, felklass: string | undefined, raknaFel: boolean, modell: string) {
  if (!utfall) return;
  a.ai.anrop += utfall.forsok;
  a.ai.tokens_in += utfall.tokens_in;
  a.ai.tokens_out += utfall.tokens_out;
  a.ai.kostnad_usd = Math.round(((a.ai.kostnad_usd || 0) + utfall.kand_usd) * 1e8) / 1e8;
  a.ai.okand_kostnad_usd = Math.round(((a.ai.okand_kostnad_usd || 0) + utfall.okand_usd) * 1e8) / 1e8;
  a.ai.senaste_ms = utfall.ms;
  a.ai.diagnostik = utfall.diagnostik;
  if (lyckat) { a.ai.modell = modell; a.ai.senaste_lyckade = nu(); a.ai.fel_i_rad = 0; a.ai.kvot = null; return; }
  if (!raknaFel) return;
  a.ai.fel += 1;
  a.ai.senaste_fel = felklass;
  a.ai.senaste_fel_tid = nu();
  if (utfall.fel?.klass === 'kvot') {
    // Kvoten gäller en modell: botemedlet är att byta modell i skrivrutan, inte att vänta ut en paus. Inget fel i rad.
    const d = utfall.fel.diagnos;
    a.ai.kvot = { modell: String(d.modell || modell), aterstalls: d.aterstalls ? String(d.aterstalls) : undefined, besked: String(d.besked || '').slice(0, 120), tid: nu() };
    return;
  }
  a.ai.fel_i_rad = (a.ai.fel_i_rad || 0) + 1;
  if (a.ai.fel_i_rad >= PAUS_EFTER_FEL) { a.ai.paus_till = new Date(Date.now() + PAUS_MIN * 60_000).toISOString(); a.ai.fel_i_rad = 0; }
}

/** Känt utöver samtalet: förifyllt, rättelser, kundens ord ur syntesen och tolkningar (svaren står redan i SAMTALET). */
function kandaRader(a: Arende, medSvar = false): KandRad[] {
  return bild(a).filter((b) => medSvar || !(b.typ === 'kund' && b.kalla.startsWith('kundens svar'))).map((b) => ({ nyckel: b.nyckel, varde: b.varde, status: b.status, kalla: b.typ === 'kund' ? 'kunden' : b.typ === 'ai' ? 'vår tolkning' : b.kalla }));
}

/**
 * Nästa steg i samtalet. Idempotent: en redan ställd fråga returneras utan modellanrop. Ett modellanrop per ärende åt
 * gången (lås i ärendet), budgeten reserveras före varje anrop och modellens innehåll kasseras om kunden hunnit ändra
 * något under väntan (kostnaden bokförs ändå). Vid fel, paus eller slut budget tar standardlistan över, synligt.
 * {fortsatt:true} öppnar ett avslutat samtal igen; {avsluta:true} låter intervjuaren avrunda på kundens begäran.
 */
export async function nasta(id: string, opts: { fortsatt?: boolean; avsluta?: boolean } = {}): Promise<NastaResultat> {
  let forsta = await lasArende(id);
  if (!forsta) throw new Vagrad('ärendet finns inte', 404);
  const vila = (a: Arende, extra: Partial<NastaResultat> = {}): NastaResultat => {
    const fr = a.fragor.filter((f) => f.status === 'stalld');
    return { a, fragor: fr, klar: fr.length === 0 && Boolean(a.samtal_klar), meddelande: '', ai: { lage: a.ai.lage, anvand: false, fallback: false }, ...extra };
  };
  /** Intervjun går vidare bara i intervjufasen utan öppen fråga, på kundens "berätta mer" (avslutsfrågan får stå öppen) eller på kundens avslut (den öppna frågan skjuts upp). */
  const kanGaVidare = (a: Arende) => {
    const oppna = a.fragor.filter((f) => f.status === 'stalld');
    const fas = fasAv(a);
    if (opts.avsluta) return fas === 'intervju' && !oppna.some((f) => f.roll === 'avslut');
    if (oppna.length && !(opts.fortsatt && oppna.every((f) => f.roll === 'avslut'))) return false;
    if (fas === 'intro') return false;
    if (fas !== 'intervju' && !opts.fortsatt) return false;
    return true;
  };
  if (!kanGaVidare(forsta)) return vila(forsta);

  let lage: AiLage = effektivtLage(forsta.ai.lage);
  let skal: string | undefined;
  if (lage !== 'regelstyrd' && forsta.ai.anrop >= MAX_AI_ANROP) { lage = 'regelstyrd'; skal = 'ärendets gräns för antal AI-svar är nådd'; }
  if (lage !== 'regelstyrd' && forsta.ai.paus_till && new Date(forsta.ai.paus_till).getTime() > Date.now()) { lage = 'regelstyrd'; skal = 'AI-stödet är pausat efter upprepade fel'; }

  // Lås: ett modellanrop åt gången per ärende (två flikar, dubbelklick, återförsök).
  const lasId = 'las_' + Math.random().toString(36).slice(2, 12);
  let upptaget = false;
  const las = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    upptaget = false;
    if (!kanGaVidare(a)) { upptaget = true; return null; }
    const p = a.ai.pagaende;
    if (p && Date.parse(p.till) > Date.now()) { upptaget = true; return null; }
    a.ai.pagaende = { id: lasId, till: new Date(Date.now() + (lage === 'claude-cli' ? turTimeoutMs(lasProv().anstrangning) + 15_000 : LAS_MS)).toISOString() };
    if (opts.fortsatt && (a.samtal_klar || fasAv(a) !== 'intervju')) {
      // "Jag vill berätta mer": avslutsfrågan stängs, samtalet öppnas igen och sammanfattningen blir inaktuell.
      bump(a);
      for (const f of a.fragor) if (f.status === 'stalld' && f.roll === 'avslut') f.status = 'tackt';
      a.samtal_klar = null;
      if (a.syntes && a.syntes.status === 'klar') a.syntes.status = 'inaktuell';
      sattFas(a, 'intervju', 'kund');
      handelse(a, 'samtal_fortsatt', {});
    }
    if (opts.avsluta) {
      // Kundens eget avslut: en obesvarad fråga skjuts upp (kan tas upp i granskningen); intervjuaren får ordet för avrundningen.
      bump(a);
      for (const f of a.fragor) if (f.status === 'stalld') { f.status = 'senare'; handelse(a, 'senare', { fraga_id: f.id, skal: 'kunden avslutade intervjun' }); }
    }
    return a;
  });
  if (upptaget) return vila(las.data, { vantar: !las.data.fragor.some((f) => f.status === 'stalld') && fasAv(las.data) === 'intervju' });
  let korning: Anropsutfall | null = null;
  try {
    forsta = las.data;
    const basRevision = forsta.revision;
    const prov = lage === 'claude-cli' ? lasProv() : null;
    const modell = prov ? prov.modell : forsta.ai.modell && lage === 'gateway' ? forsta.ai.modell : standardModell();

    let utfall: Anropsutfall | null = null;
    let ut: TurUtdata | null = null;
    let valideringsfel: string | undefined;
    if (lage !== 'regelstyrd') {
      const n = agentFragor(forsta);
      const kontext = byggTurKontext(forsta, {
        kanda: kandaRader(forsta),
        tackning: tackning(forsta).map((x) => ({ nyckel: x.nyckel, status: x.status, fraga: x.fraga, prio: x.prio })),
        farAvrunda: farAvrunda(forsta),
        avrundaNu: Boolean(opts.avsluta) || n >= AVSLUT_EFTER_FRAGOR,
        viktigaKvar: aterstar(forsta).viktiga,
        vagvisning: n === Math.ceil(AVSLUT_EFTER_FRAGOR / 2),
        maxFragor: AVSLUT_EFTER_FRAGOR,
      });
      utfall = await korModell(forsta, lage, modell, turKontrakt(kontext.text, prov), prov);
      korning = utfall;
      if (utfall.svar) {
        ut = valideraTur(utfall.svar.rå, kontext);
        if (!ut) valideringsfel = 'modellens svar saknade användbar fråga eller giltigt avslut';
      }
    }
    const fallback = lage !== 'regelstyrd' && !ut;
    const felklass = utfall?.budgetStopp ? 'budget' : utfall?.fel?.klass || (valideringsfel ? 'sakligt_otillrackligt' : undefined);

    let forkastad = false;
    let tillampat: ReturnType<typeof tillampaTur> | null = null;
    const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
      forkastad = false;
      tillampat = null;
      if (a.ai.pagaende?.id === lasId) a.ai.pagaende = null;
      bokforAnrop(a, utfall, Boolean(utfall?.svar && ut), felklass, Boolean(utfall?.fel || valideringsfel), modell);
      a.ai.felklass = felklass;
      a.ai.budget_skal = utfall?.budgetStopp;
      a.ai.aktuell = lage === 'regelstyrd' ? (skal ? 'pausad' : 'av') : utfall?.budgetStopp ? 'pausad' : fallback ? 'reserv' : 'aktiv';
      const annanHannFore = a.fragor.some((f) => f.status === 'stalld');
      const inaktuell = a.revision !== basRevision;
      if (annanHannFore || inaktuell) {
        forkastad = true;
        handelse(a, 'nasta_forkastad', { skal: inaktuell ? 'kundrevisionen ändrades under modellväntan; inget gammalt modellinnehåll används' : 'en annan flik hann ställa nästa fråga; anropet bokfört', ms: utfall?.ms, kostnad_usd: utfall?.kand_usd });
        return a;
      }
      bump(a);
      let fragaId: string | null = null;
      if (ut) {
        tillampat = tillampaTur(a, ut, { avsluta: opts.avsluta });
        fragaId = tillampat.fraga;
        if (!fragaId && !tillampat.klar) fragaId = tillampaRegelstyrd(a, ut.aterkoppling || undefined);
      } else if (opts.avsluta) {
        fragaId = stangSamtal(a, { meddelande: avslutstextRegelstyrd(a), valjare: 'kund' });
      } else {
        fragaId = tillampaRegelstyrd(a);
      }
      handelse(a, 'nasta', { lage: ut ? lage : 'regelstyrd', slag: opts.avsluta ? 'avslut' : 'tur', ...(prov && ut ? { modell, anstrangning: prov.anstrangning } : {}), fallback, skal: skal || utfall?.budgetStopp, felklass, fraga: fragaId, klar: Boolean(a.samtal_klar), ms: utfall?.ms, forsok: utfall?.forsok, tokens_in: utfall?.tokens_in, tokens_out: utfall?.tokens_out, kostnad_usd: utfall?.kand_usd, okand_usd: utfall?.okand_usd, berorda: tillampat?.berorda, vagvisning: ut?.vagvisning, valideringsfel });
      return a;
    });
    const a = await efterkontrolleraDoman(r.data).catch(() => r.data);
    const fragor = a.fragor.filter((f) => f.status === 'stalld');
    return {
      a,
      fragor,
      klar: fragor.length === 0 && Boolean(a.samtal_klar),
      forkastad,
      meddelande: ut?.aterkoppling || '',
      ai: { lage: ut ? lage : 'regelstyrd', anvand: Boolean(ut), fallback, fel: skal || utfall?.budgetStopp || felklass, modell: ut ? modell : undefined, ms: utfall?.ms, kostnad_usd: utfall ? utfall.kand_usd : null },
    };
  } catch (e) {
    // Ett fel efter låset får inte lämna ärendet låst i 80 s: släpp låset om det fortfarande är vårt och låt felet nå
    // kunden, som då ser "Försök igen" (det kunden svarat är redan sparat).
    await uppdateraDok<Arende>(arendeStig(id), (a) => {
      if (a.ai.pagaende?.id !== lasId) return null; // slutskrivningen hann ske (och bokförde) eller en annan tur äger låset
      a.ai.pagaende = null;
      // Ett gjort modellanrop bokförs i ärendet även här, så att ärendets kostnadstak ser det vid ett nytt försök.
      if (korning) {
        a.ai.anrop += korning.forsok;
        a.ai.tokens_in += korning.tokens_in;
        a.ai.tokens_out += korning.tokens_out;
        a.ai.kostnad_usd = Math.round(((a.ai.kostnad_usd || 0) + korning.kand_usd) * 1e8) / 1e8;
        a.ai.okand_kostnad_usd = Math.round(((a.ai.okand_kostnad_usd || 0) + korning.okand_usd) * 1e8) / 1e8;
      }
      handelse(a, 'nasta_fel', { fel: e instanceof Error ? e.name : 'okant', kostnad_usd: korning?.kand_usd, okand_usd: korning?.okand_usd });
      return a;
    }).catch(() => undefined);
    throw e;
  }
}

// ---------- intervjuns faser: börja, avsluta, granska, sammanfatta ----------

/** Kunden börjar intervjun: öppningsfrågan ställs utan modellanrop. Idempotent: bara i introfasen. */
export async function borja(id: string): Promise<{ a: Arende; ny: boolean }> {
  let ny = false;
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    ny = false;
    if (fasAv(a) !== 'intro' || a.fragor.length) return null;
    bump(a);
    a.omgang += 1;
    a.fragor.push({ ...OPPNING, roll: 'oppning', inledning: OPPNING_INLEDNING, kalla: 'agent', typ: 'oppen', omgang: a.omgang, stalld: nu(), status: 'stalld', valjare: 'regelstyrd' });
    sattFas(a, 'intervju', 'kund');
    handelse(a, 'nasta', { lage: 'fast oppning', fraga: OPPNING.id });
    ny = true;
    return a;
  });
  return { a: r.data, ny };
}

/** Kunden avslutar intervjun själv. Med en aktiv intervjuare får den ordet för avrundningen; annars rundas av med fast text. */
export async function avsluta(id: string): Promise<{ a: Arende; ny: boolean; vantar?: boolean }> {
  const forsta = await lasArende(id);
  if (!forsta) throw new Vagrad('ärendet finns inte', 404);
  if (fasAv(forsta) !== 'intervju') return { a: forsta, ny: false };
  const lage = effektivtLage(forsta.ai.lage);
  const pausad = Boolean(forsta.ai.paus_till && Date.parse(forsta.ai.paus_till) > Date.now());
  if (lage !== 'regelstyrd' && forsta.ai.anrop < MAX_AI_ANROP && !pausad) {
    const r = await nasta(id, { avsluta: true });
    if (fasAv(r.a) === 'avslut') return { a: r.a, ny: true };
    if (r.vantar || r.forkastad) return { a: r.a, ny: false, vantar: true };
  }
  let ny = false;
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    ny = false;
    if (fasAv(a) !== 'intervju') return null;
    bump(a);
    for (const f of a.fragor) if (f.status === 'stalld') { f.status = 'senare'; handelse(a, 'senare', { fraga_id: f.id, skal: 'kunden avslutade intervjun' }); }
    stangSamtal(a, { meddelande: avslutstextRegelstyrd(a), valjare: 'kund' });
    ny = true;
    return a;
  });
  return { a: r.data, ny };
}

export interface SyntesResultat { a: Arende; utford: boolean; fallback: boolean; vantar?: boolean; forkastad?: boolean; fel?: string }

/** Kunden går vidare till granskningen: en obesvarad avslutsfråga stängs, sedan skrivs sammanfattningen. */
export async function granska(id: string, opts: { igen?: boolean } = {}): Promise<SyntesResultat> {
  await uppdateraDok<Arende>(arendeStig(id), (a) => {
    if (fasAv(a) !== 'avslut') return null;
    const oppna = a.fragor.filter((f) => f.status === 'stalld');
    if (!oppna.length) return null;
    bump(a);
    for (const f of oppna) f.status = f.roll === 'avslut' ? 'tackt' : 'senare';
    handelse(a, 'granskning_begard', { stangda: oppna.map((f) => f.id) });
    return a;
  });
  return syntes(id, opts);
}

/**
 * Sammanfattningen efter avslutad intervju: en modellkörning (claude-cli lokalt, gateway när den är påslagen) som
 * skriver den berättande sammanfattningen och tillämpar noteringarna, eller en deterministisk sammanställning i det
 * modellfria läget och som reserv efter upprepade fel. Idempotent: en aktuell sammanfattning skrivs inte om utan `igen`.
 * Ett modellanrop åt gången per ärende; ett svar som kommer efter en nyare revision kasseras (klienten försöker igen).
 */
export async function syntes(id: string, opts: { igen?: boolean } = {}): Promise<SyntesResultat> {
  let forsta = await lasArende(id);
  if (!forsta) throw new Vagrad('ärendet finns inte', 404);
  const kan = (a: Arende) => {
    const fas = fasAv(a);
    return (fas === 'avslut' || (Boolean(opts.igen) && (fas === 'granskning' || fas === 'inlamnat'))) && !a.fragor.some((f) => f.status === 'stalld');
  };
  if (!kan(forsta)) return { a: forsta, utford: false, fallback: false };
  if (!opts.igen && forsta.syntes?.status === 'klar' && forsta.syntes.bas_revision >= kundRevision(forsta)) {
    if (fasAv(forsta) !== 'avslut') return { a: forsta, utford: false, fallback: false };
    const r = await uppdateraDok<Arende>(arendeStig(id), (a) => { if (fasAv(a) !== 'avslut') return null; bump(a); sattFas(a, 'granskning', 'kund'); return a; });
    return { a: r.data, utford: false, fallback: false };
  }
  let lage: AiLage = effektivtLage(forsta.ai.lage);
  const aktivtLage = lage;
  const misslyckade = forsta.syntes?.status === 'misslyckad' ? forsta.syntes.forsok : 0;
  if (lage !== 'regelstyrd' && (forsta.ai.anrop >= MAX_AI_ANROP || misslyckade >= PAUS_EFTER_FEL)) lage = 'regelstyrd';
  if (lage !== 'regelstyrd' && forsta.ai.paus_till && Date.parse(forsta.ai.paus_till) > Date.now()) lage = 'regelstyrd';
  if (lage === 'regelstyrd') {
    const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
      if (!kan(a)) return null;
      const bas = a.revision;
      bump(a);
      skrivSyntes(a, syntesRegelstyrd(a), { valjare: 'regelstyrd', bas_revision: bas });
      if (aktivtLage !== 'regelstyrd') a.ai.aktuell = 'reserv';
      if (fasAv(a) === 'avslut') sattFas(a, 'granskning', 'regelstyrd');
      handelse(a, 'syntes', { lage: 'regelstyrd', fallback: aktivtLage !== 'regelstyrd', id: a.syntes!.id, bas_revision: bas });
      return a;
    });
    return { a: r.data, utford: true, fallback: aktivtLage !== 'regelstyrd' };
  }

  const prov = lage === 'claude-cli' ? lasSyntesProv() : null;
  const modell = prov ? prov.modell : forsta.ai.modell && lage === 'gateway' ? forsta.ai.modell : standardModell();
  const lasId = 'las_' + Math.random().toString(36).slice(2, 12);
  let upptaget = false;
  const las = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    upptaget = false;
    if (!kan(a)) { upptaget = true; return null; }
    const p = a.ai.pagaende;
    if (p && Date.parse(p.till) > Date.now()) { upptaget = true; return null; }
    a.ai.pagaende = { id: lasId, till: new Date(Date.now() + (lage === 'claude-cli' ? syntesTimeoutMs() : LAS_MS) + 15_000).toISOString() };
    return a;
  });
  if (upptaget) return { a: las.data, utford: false, fallback: false, vantar: Boolean(las.data.ai.pagaende) && kan(las.data) };
  let korning: Anropsutfall | null = null;
  try {
    forsta = las.data;
    const bas = forsta.revision;
    const kontext = byggSyntesKontext(forsta, {
      kanda: kandaRader(forsta, true),
      tackning: tackning(forsta).map((x) => ({ nyckel: x.nyckel, status: x.status, fraga: x.fraga, prio: x.prio })),
      utlosta: forsta.foljdregler_utlosta.map((u) => `${u.regel} (${u.fraga_id}: "${u.traff}")`),
    });
    const utfall = await korModell(forsta, lage, modell, syntesKontrakt(kontext.text), prov);
    korning = utfall;
    let ut: SyntesUtdata | null = null;
    let valideringsfel: string | undefined;
    if (utfall.svar) {
      ut = valideraSyntes(utfall.svar.rå, kontext);
      if (!ut) valideringsfel = 'modellens sammanfattning gick inte att använda';
    }
    const felklass = utfall.budgetStopp ? 'budget' : utfall.fel?.klass || (valideringsfel ? 'sakligt_otillrackligt' : undefined);
    let forkastad = false;
    let fallback = false;
    const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
      forkastad = false;
      fallback = false;
      if (a.ai.pagaende?.id === lasId) a.ai.pagaende = null;
      bokforAnrop(a, utfall, Boolean(utfall.svar && ut), felklass, Boolean(utfall.fel || valideringsfel), modell);
      a.ai.felklass = felklass;
      a.ai.budget_skal = utfall.budgetStopp;
      if (a.revision !== bas || !kan(a)) {
        forkastad = true;
        handelse(a, 'syntes_forkastad', { skal: 'ärendet ändrades under modellväntan; inget gammalt modellinnehåll används', ms: utfall.ms, kostnad_usd: utfall.kand_usd });
        return a;
      }
      bump(a);
      if (ut) {
        const tillampat = tillampaSyntes(a, ut, bas, modell);
        skrivSyntes(a, { sammanfattning: ut.sammanfattning, nyckelinsikt: ut.nyckelinsikt, oppet: ut.oppet }, { valjare: 'ai', bas_revision: bas, modell, anstrangning: prov?.anstrangning, ms: utfall.ms, avvisade: ut.avvisade.length });
        a.ai.aktuell = 'aktiv';
        if (fasAv(a) === 'avslut') sattFas(a, 'granskning', 'ai');
        handelse(a, 'syntes', { lage, modell, ...(prov ? { anstrangning: prov.anstrangning } : {}), id: a.syntes!.id, bas_revision: bas, ms: utfall.ms, forsok: utfall.forsok, tokens_in: utfall.tokens_in, tokens_out: utfall.tokens_out, kostnad_usd: utfall.kand_usd, tillampat, avvisade: ut.avvisade.length ? ut.avvisade : undefined });
      } else {
        const n = (a.syntes?.status === 'misslyckad' ? a.syntes.forsok : 0) + 1;
        a.ai.aktuell = utfall.budgetStopp ? 'pausad' : 'reserv';
        if (n >= PAUS_EFTER_FEL) {
          // Reserv efter upprepade fel: kunden når granskningen med en deterministisk sammanställning av sina egna ord.
          skrivSyntes(a, syntesRegelstyrd(a), { valjare: 'regelstyrd', bas_revision: bas });
          a.syntes!.forsok = n;
          fallback = true;
          if (fasAv(a) === 'avslut') sattFas(a, 'granskning', 'regelstyrd');
          handelse(a, 'syntes', { lage: 'regelstyrd', fallback: true, felklass, forsok: n, id: a.syntes!.id, bas_revision: bas });
        } else {
          a.syntes = { id: `S${a.revision}`, status: 'misslyckad', bas_revision: bas, revision: a.revision, tid: nu(), valjare: 'ai', modell, anstrangning: prov?.anstrangning, ms: utfall.ms, forsok: n, fel: felklass, sammanfattning: '', nyckelinsikt: '', oppet: [] };
          handelse(a, 'syntes_fel', { felklass, forsok: n, ms: utfall.ms, skal: utfall.budgetStopp, valideringsfel });
        }
      }
      return a;
    });
    const a = await efterkontrolleraDoman(r.data).catch(() => r.data);
    return { a, utford: Boolean(ut) || fallback, fallback, forkastad, fel: felklass };
  } catch (e) {
    await uppdateraDok<Arende>(arendeStig(id), (a) => {
      if (a.ai.pagaende?.id !== lasId) return null;
      a.ai.pagaende = null;
      if (korning) bokforAnrop(a, korning, false, 'fel', false, modell);
      handelse(a, 'syntes_fel', { fel: e instanceof Error ? e.name : 'okant', kostnad_usd: korning?.kand_usd });
      return a;
    }).catch(() => undefined);
    throw e;
  }
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

export interface SamtyckeKropp { version: string; text: string; bekraftat: boolean; transkript_last: boolean }

/**
 * Inlämningen kräver kundens samtycke med exakt den text som visades (samtycke/1) och att intervjun är genomläst
 * (fasen granskning, eller en ny inlämning efter ändringar). Idempotent på klientens nyckel.
 */
export async function lamnaIn(id: string, p: { idempotens: string; samtycke: SamtyckeKropp }): Promise<Arende> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p?.idempotens || '')) throw new Vagrad('idempotensnyckel saknas');
  const s = p.samtycke;
  if (!s || s.version !== SAMTYCKE.version || s.text !== SAMTYCKE.text || s.bekraftat !== true || s.transkript_last !== true) throw new Vagrad('samtyckestexten stämmer inte med den som visades; ladda om sidan och läs igenom intervjun igen', 422);
  const r = await uppdateraDok<Arende>(arendeStig(id), (a) => {
    if (a.inlamningar.some((i) => i.samtycke?.idempotens === p.idempotens)) return null;
    const fas = fasAv(a);
    if (fas !== 'granskning' && fas !== 'inlamnat') throw new Vagrad('intervjun behöver läsas igenom innan den lämnas in', 409);
    const sista = a.inlamningar[a.inlamningar.length - 1];
    if (sista && sista.revision === a.revision) return null;
    bump(a);
    a.inlamningar.push({ tid: nu(), revision: a.revision, svar: a.svar.length, material: a.material.filter((m) => m.status === 'mottagen').length, samtycke: { version: SAMTYCKE.version, text: SAMTYCKE.text, tid: nu(), revision: a.revision, syntes_id: a.syntes?.status === 'klar' ? a.syntes.id : null, transkript_last: true, idempotens: p.idempotens } });
    signalera(a, 'inlamning');
    sattFas(a, 'inlamnat', 'kund');
    handelse(a, 'inlamnad', { svar: a.svar.length, samtycke: SAMTYCKE.version });
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
  const omradeAv = (nyckel: string, standard = 'H') => omradeFor(a, nyckel, standard) || standard;
  const tolkningar = (a.uppgifter || []).filter((u) => u.giltig && u.status === 'tolkning').map((u) => ({ nyckel: u.nyckel, varde: u.varde, status: 'tolkning', kalla: `kundstart AI rev ${u.bas_revision} (${u.modell || 'modell'}) ur ${u.kalla_id}`, omrade: omradeAv(u.nyckel, u.avsnitt === 'mal' ? 'A' : 'H'), datum: u.tid.slice(0, 10) }));
  const faktaAi = [...a.fakta_ai.filter((f) => f.giltig).map((f) => ({ nyckel: f.nyckel, varde: f.varde, status: f.status, kalla: f.kalla, omrade: f.omrade, datum: f.datum })), ...tolkningar];
  const rattelserFakta = a.rattelser.map((r) => ({ nyckel: r.nyckel, varde: r.varde, status: 'kunden uppger', kalla: `kundstart rättelse rev ${r.revision}`, omrade: omradeAv(r.nyckel), datum: r.mottaget.slice(0, 10), tidigare: r.tidigare }));
  const kunduppgifter = (a.uppgifter || []).filter((u) => u.giltig && u.status === 'kunden uppger').map((u) => ({ id: u.id, nyckel: u.nyckel, rubrik: u.rubrik, avsnitt: u.avsnitt, varde: u.varde, citat: u.citat, kalla_typ: u.kalla_typ, kalla_id: u.kalla_id, kalla_revision: u.kalla_revision, revision: u.revision, omrade: omradeAv(u.nyckel, u.avsnitt === 'mal' ? 'A' : 'H'), tacker: u.tacker || null, status: 'kunden uppger' }));
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
    ai: { ...a.ai, pagaende: undefined },
    fakta_forifyllda: a.fakta_forifyllda,
    omgangar,
    svar: a.svar,
    rattelser: a.rattelser,
    fakta_ai: faktaAi,
    rattelser_fakta: rattelserFakta,
    kunduppgifter,
    tillval: (a.tillval || []).map((t) => ({ id: t.id, beskrivning: t.beskrivning, kundval: t.kundval, system: t.system, not: t.not, kalla: t.kalla, citat: t.citat, fraga_id: t.fraga_id, revision: t.revision, rekommendation: t.rekommendation?.giltig ? t.rekommendation : null, digitala: t.digitala || null, kontroll: t.kontroll || null, historik: t.historik.map((h) => ({ ...h, idempotens: undefined })) })),
    research: a.research || [],
    tackning_agent: (a.tackning_agent || []).filter((m) => m.giltig),
    samtal_klar: a.samtal_klar || null,
    fas: fasAv(a),
    fas_historik: a.fas_historik || [],
    syntes: a.syntes ? { ...a.syntes } : null,
    transkript: transkript(a),
    berorda: a.berorda || [],
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
