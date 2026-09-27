// Digitalas frågebank (snapshot ur nortropic-digitala verktyg/intervju.py) och den regelstyrda delen av
// intervjulogiken: luckor i prioritetsordning och följdfrågor ur svaren. Kundstart har inga egna frågor.
import bankJson from '../intervju-bank.json';

export interface BankFraga { id: string; omrade: string; nyckel: string; text: string; paverkar: string; prio: number }
export interface BankRegel { namn: string; monster: string; flaggor: string; fragor: { id: string; omrade: string; nyckel: string; text: string }[]; paverkar: string }
export interface Bank {
  schema: string;
  kalla: { fil: string; repo: string; sha256: string; git_rev: string | null; gren: string | null; ren: boolean };
  per_omgang: number;
  statusar: string[];
  omraden: Record<string, string>;
  grund: BankFraga[];
  foljdregler: BankRegel[];
  hemligt: { monster: string; flaggor: string };
}

export const BANK = bankJson as Bank;

const REGLER = BANK.foljdregler.map((r) => ({ ...r, rx: new RegExp(r.monster, r.flaggor.includes('i') ? 'iu' : 'u') }));
const HEMLIGT = new RegExp(BANK.hemligt.monster, 'iu');

export function grundFraga(id: string): BankFraga | undefined {
  return BANK.grund.find((g) => g.id === id);
}

export function regelFraga(id: string): { regel: BankRegel; fraga: BankRegel['fragor'][number] } | undefined {
  for (const r of BANK.foljdregler) {
    const f = r.fragor.find((x) => x.id === id);
    if (f) return { regel: r, fraga: f };
  }
  return undefined;
}

/** Grundfrågor vars nyckel varken är känd eller redan ställd, i prioritetsordning (samma regel som intervju.py:s luckor). */
export function luckor(kanda: Set<string>, stallda: Set<string>): BankFraga[] {
  return [...BANK.grund]
    .sort((a, b) => a.prio - b.prio || a.id.localeCompare(b.id))
    .filter((g) => !kanda.has(g.nyckel) && !stallda.has(g.id));
}

/** Följdregler som ett svar utlöser (samma mönster som intervju.py:s FOLJDREGLER; JS:s \b är ASCII-bundet, vilket
 * kan ge små skillnader vid ord som börjar eller slutar på å/ä/ö — Digitalas import räknar om reglerna). */
export function utlosta(text: string): { regel: BankRegel; traff: string }[] {
  const ut: { regel: BankRegel; traff: string }[] = [];
  for (const r of REGLER) {
    const m = r.rx.exec(text);
    if (m) ut.push({ regel: r, traff: m[0] });
  }
  return ut;
}

export function serUtSomHemlighet(text: string): boolean {
  return HEMLIGT.test(text);
}

/** Läsbar rubrik för en faktanyckel i kundens vy. */
export function rubrik(nyckel: string): string {
  const g = BANK.grund.find((x) => x.nyckel === nyckel);
  if (g) return RUBRIKER[nyckel] ?? g.text.split(/[?.]/)[0];
  for (const r of BANK.foljdregler) {
    const f = r.fragor.find((x) => x.nyckel === nyckel);
    if (f) return RUBRIKER[nyckel] ?? f.text.split(/[?.]/)[0];
  }
  return RUBRIKER[nyckel] ?? nyckel.replace(/_/g, ' ');
}

const RUBRIKER: Record<string, string> = {
  verksamhetsmal: 'Vad webbplatsen ska förändra',
  erbjudande: 'Vad ni erbjuder',
  nulage: 'Vad som fungerar och inte i dag',
  undvik: 'Förfrågningar ni helst slipper',
  besokare: 'Vilka som hör av sig',
  senaste_forfragan: 'Senaste förfrågan',
  fore_handling: 'Vad en ny kund behöver veta först',
  insiktskalla: 'Vad som är sett och vad som är känsla',
  efter_inskick: 'Vad som händer efter ett inskick',
  fordelning: 'Hur ärenden fördelas',
  felvag: 'När något går fel',
  system: 'System ni använder',
  kontoagare: 'Vem som äger kontona',
  ton: 'Hur ni vill uppfattas',
  material: 'Material som finns',
  referenser: 'Webbplatser ni gillar eller ogillar',
  hittar: 'Hur folk hittar er',
  data: 'Statistik som finns',
  bra_forfragan: 'Vad en bra förfrågan är',
  redaktor: 'Vem som uppdaterar innehållet',
  hantering: 'Vem som hanterar förfrågningar och drift',
  migrering: 'Befintlig webbplats',
  ramar: 'Ramar',
  okant: 'Vad ni inte vet ännu',
  kontaktvagar: 'Kontaktvägar',
  rackvidd: 'Var ni arbetar',
  oppettider: 'Öppettider',
  bokning_tjanster: 'Tjänster som ska kunna bokas',
  bokning_tillganglighet: 'Bokningsbara tider',
  bokning_bekraftelse: 'Bekräftelse, ombokning och avbokning',
  bokning_system: 'Bokningssystem i dag',
  betalning_vad: 'Vad som ska betalas på webbplatsen',
  betalning_system: 'Betallösning i dag',
  crm_falt: 'Uppgifter till kundregistret',
  crm_agare: 'Vem som administrerar kundregistret',
  nyhetsbrev: 'Nyhetsbrev',
  sprak: 'Språk',
  migrering_adresser: 'Adresser som måste behållas',
  migrering_innehall: 'Innehåll som ska följa med',
  migrering_vard: 'Var den befintliga webbplatsen ligger',
  okant_vem: 'Vem som kan svara',
  besok: 'Besök hos er',
};
