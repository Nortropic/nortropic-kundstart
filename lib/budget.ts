// Kostnadsspärr för kundsamtalets modellanrop, verkställd på servern.
//
// Tre tak i USD: per ärende, per dygn (UTC) och per kalendermånad. Före varje modellanrop reserveras anropets
// högsta möjliga kostnad (indata uppskattad ur prompten, utdata = anropets max_completion_tokens) i ett gemensamt
// dokument i Blob-lagret med villkorad skrivning (ETag). Två samtidiga anrop kan därför inte båda passera ett tak.
// Efter anropet bokförs gatewayens faktiska usage.cost; saknas den (t.ex. timeout) bokförs hela reservationen som
// okänd förbrukning, så att taket hellre stänger för tidigt än för sent. Inga krediter köps och inget belopp antas:
// taken är konfigurerade gränser inom teamets befintliga fria AI Gateway-kredit.
import { lasDok, skapaDok, uppdateraDok } from './lagring';

export interface BudgetGranser { arende_usd: number; dygn_usd: number; manad_usd: number }

interface Reservation { id: string; arende: string; usd: number; tid: string; till: string }

export interface BudgetDok {
  schema: 'kundstart-budget/1';
  manad: string;
  forbrukat_usd: number;
  okand_usd: number;
  anrop: number;
  vagrade: number;
  per_dygn: Record<string, { usd: number; anrop: number; vagrade: number }>;
  reservationer: Reservation[];
  uppdaterad: string;
}

/** Listpris per token (USD) för modeller som faktiskt används; okänd modell räknas med ett högt försiktighetspris. */
const PRIS: Record<string, { in: number; ut: number }> = {
  'openai/gpt-5-mini': { in: 0.25e-6, ut: 2e-6 }, // AI Gateway /v1/models, läst 2026-09-28
};
const FORSIKTIGT = { in: 5e-6, ut: 25e-6 };

function tal(v: string | undefined, standard: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : standard;
}

export function granser(): BudgetGranser {
  return {
    arende_usd: tal(process.env.KUNDSTART_AI_BUDGET_ARENDE_USD, 0.4),
    dygn_usd: tal(process.env.KUNDSTART_AI_BUDGET_DYGN_USD, 1),
    manad_usd: tal(process.env.KUNDSTART_AI_BUDGET_MANAD_USD, 3.5),
  };
}

export function maxKostnad(modell: string, promptTecken: number, maxUtTokens: number): number {
  const p = PRIS[modell] || FORSIKTIGT;
  // Svensk text ger sällan fler än en token per tre tecken; + 200 för schema och meddelandeformat.
  const inTokens = Math.ceil(promptTecken / 3) + 200;
  return inTokens * p.in + maxUtTokens * p.ut;
}

/** Kostnad ur token när gatewayen inte redovisat usage.cost (listpris). */
export function kostnadUrToken(modell: string, tin: number, tut: number): number {
  const p = PRIS[modell] || FORSIKTIGT;
  return tin * p.in + tut * p.ut;
}

const manad = (d = new Date()) => d.toISOString().slice(0, 7);
const dygn = (d = new Date()) => d.toISOString().slice(0, 10);
const stig = (m: string) => `budget/ai-${m}.json`;
const runda = (x: number) => Math.round(x * 1e8) / 1e8;

function tomt(m: string): BudgetDok {
  return { schema: 'kundstart-budget/1', manad: m, forbrukat_usd: 0, okand_usd: 0, anrop: 0, vagrade: 0, per_dygn: {}, reservationer: [], uppdaterad: new Date().toISOString() };
}

async function sakerstall(m: string): Promise<void> {
  if (await lasDok<BudgetDok>(stig(m))) return;
  try {
    await skapaDok(stig(m), tomt(m));
  } catch {
    // En annan instans hann skapa dokumentet; det är det som gäller.
  }
}

export type Reservationsutfall = { ok: true; id: string; usd: number } | { ok: false; skal: string; tak: 'arende' | 'dygn' | 'manad' };

/**
 * Reserverar ett anrops högsta kostnad mot dygns- och månadstaket. Ärendets tak kontrolleras mot ärendets egen
 * bokföring (förbrukat + okänt), som skrivs i ärendedokumentet i samma villkorade skrivning som resultatet.
 */
export async function reservera(arendeId: string, arendeForbrukat: number, usd: number, g = granser()): Promise<Reservationsutfall> {
  if (arendeForbrukat + usd > g.arende_usd) return { ok: false, skal: 'ärendets budget för AI-stödet är förbrukad', tak: 'arende' };
  const m = manad();
  await sakerstall(m);
  const id = 'res_' + Math.random().toString(36).slice(2, 12);
  let utfall: Reservationsutfall = { ok: false, skal: 'okänt', tak: 'manad' };
  await uppdateraDok<BudgetDok>(stig(m), (b) => {
    const nu = Date.now();
    b.reservationer = b.reservationer.filter((r) => Date.parse(r.till) > nu);
    const reserverat = b.reservationer.reduce((s, r) => s + r.usd, 0);
    const d = dygn();
    const idag = b.per_dygn[d] || { usd: 0, anrop: 0, vagrade: 0 };
    const reserveratIdag = b.reservationer.filter((r) => r.tid.slice(0, 10) === d).reduce((s, r) => s + r.usd, 0);
    if (b.forbrukat_usd + b.okand_usd + reserverat + usd > g.manad_usd) {
      utfall = { ok: false, skal: 'månadens budget för AI-stödet är nådd', tak: 'manad' };
    } else if (idag.usd + reserveratIdag + usd > g.dygn_usd) {
      utfall = { ok: false, skal: 'dagens budget för AI-stödet är nådd', tak: 'dygn' };
    } else {
      utfall = { ok: true, id, usd: runda(usd) };
      b.reservationer.push({ id, arende: arendeId, usd: runda(usd), tid: new Date(nu).toISOString(), till: new Date(nu + 120_000).toISOString() });
      b.uppdaterad = new Date(nu).toISOString();
      return b;
    }
    b.vagrade += 1;
    idag.vagrade += 1;
    b.per_dygn[d] = idag;
    b.uppdaterad = new Date(nu).toISOString();
    return b;
  });
  return utfall;
}

/** Bokför ett avslutat anrop: faktisk kostnad när den är känd, annars hela reservationen som okänd förbrukning. */
export async function avrakna(id: string, faktiskUsd: number | null, reserveratUsd: number): Promise<void> {
  const m = manad();
  await sakerstall(m);
  await uppdateraDok<BudgetDok>(stig(m), (b) => {
    b.reservationer = b.reservationer.filter((r) => r.id !== id);
    const d = dygn();
    const idag = b.per_dygn[d] || { usd: 0, anrop: 0, vagrade: 0 };
    if (faktiskUsd === null) {
      b.okand_usd = runda(b.okand_usd + reserveratUsd);
      idag.usd = runda(idag.usd + reserveratUsd);
    } else {
      b.forbrukat_usd = runda(b.forbrukat_usd + faktiskUsd);
      idag.usd = runda(idag.usd + faktiskUsd);
    }
    b.anrop += 1;
    idag.anrop += 1;
    b.per_dygn[d] = idag;
    b.uppdaterad = new Date().toISOString();
    return b;
  });
}

export async function budgetLage(): Promise<{ granser: BudgetGranser; manad: BudgetDok | null }> {
  const r = await lasDok<BudgetDok>(stig(manad()));
  return { granser: granser(), manad: r?.data ?? null };
}
