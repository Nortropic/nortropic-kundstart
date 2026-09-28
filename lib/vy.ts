// Vyn som kundens webbläsare får: inga lagringssökvägar, inga idempotensnycklar, ingen händelselogg, ingen kostnad.
// Samtalet och "Ditt uppdrag" är två vyer av samma ärende och byggs här ur samma dokument.
import { aterstar, bild, type BildRad } from './arende';
import { BANK } from './bank';
import { kontrollText } from './doman';
import { tackning, behovMedStatus } from './tackning';
import { DIGITALA_TEXT, GRUPPER, KUNDVAL_TEXT, TILLVAL, tillvalDef, tillvalNamn } from './tillval';
import type { Arende, Fraga, Tillval, TillvalKundval } from './typer';

export interface FragaVy {
  id: string;
  omrade: string;
  omrade_namn: string;
  nyckel: string;
  text: string;
  varfor: string;
  typ: 'oppen' | 'val' | 'tillval';
  alternativ?: string[];
  tillval?: string[];
  inledning?: string;
  valjare: 'regelstyrd' | 'ai';
}

export interface DialogRad { fraga_id: string; fraga: string; svar: string; typ: string; tid: string; nyckel: string; andrad: number }

/** Samtalet i ordning: agentens (eller standardlistans) fråga med återkoppling, sedan kundens svar ordagrant. */
export interface SamtalRad { fraga_id: string; fraga: string; inledning?: string; valjare: 'regelstyrd' | 'ai'; kalla: string; stalld: string; svar?: { text: string; typ: string; tid: string; andrad: number }; status: string }

export interface MaterialVy { id: string; typ: 'fil' | 'lank'; filnamn?: string; mime?: string; storlek?: number; url?: string; beskrivning?: string; mottaget: string; lasstatus: string }

export interface TillvalVy {
  id: string;
  namn: string;
  grupp: string;
  kort: string;
  digitala: string;
  kostnad: string;
  grans: string;
  annat: boolean;
  kundval: TillvalKundval | null;
  kundval_text: string | null;
  system?: string;
  kalla?: 'kontroll' | 'samtal';
  citat?: string;
  rekommendation: string | null;
  digitala_status: string | null;
  kontroll: { text: string; tid: string; anmarkningar: string[]; registrerad: boolean | null; doman: string } | null;
}

export interface UppdragVy {
  mal: BildRad[];
  forstatt: { omrade: string; namn: string; rader: BildRad[] }[];
  valda: TillvalVy[];
  rekommenderade: TillvalVy[];
  aterstar: { nyckel: string; fraga: string; status: string; prio: number }[];
  research: { id: string; fraga: string; varfor: string }[];
  senare: { id: string; text: string; not?: string }[];
}

export interface Vy {
  arende: { id: string; kund: { namn: string }; testdialog: boolean; revision: number; kanal: string; inlamnad: { tid: string; svar: number; material: number } | null; uppdaterad: string };
  ai: { lage: string; modell?: string; anrop: number; status: string; beskrivning: string };
  tackning: ReturnType<typeof tackning>;
  behov: { id: string; nyckel: string; citat: string; status: string; kan_oppnas: boolean }[];
  overlamning: string;
  overforing: 'ej_inlamnat' | 'vantar' | 'hamtat' | 'andrat_efter';
  oppna: FragaVy[];
  senare: FragaVy[];
  samtal: SamtalRad[];
  dialog: DialogRad[];
  bild: BildRad[];
  uppdrag: UppdragVy;
  tillval: TillvalVy[];
  grupper: string[];
  material: MaterialVy[];
  aterstar: { viktiga: number; ovriga: number };
  klar: boolean;
  avslut: string | null;
}

const OMRADEN: Record<string, string> = { A: 'Verksamhet och erbjudande', B: 'Besökare och situationer', C: 'Hur ni arbetar', D: 'System och åtkomster', E: 'Varumärke, innehåll och förtroende', F: 'Synlighet och mätning', G: 'Förvaltning', H: 'Ramar och övrigt', '': 'Övrigt' };

function varfor(f: Fraga): string {
  // "vad svaret påverkar" ur banken eller agentens motivering, utan interna referenser (brief §, filnamn).
  return f.paverkar.replace(/\s*\([^)]*\)/g, '').replace(/\s*;.*$/, '').trim();
}

export function fragaVy(f: Fraga): FragaVy {
  return { id: f.id, omrade: f.omrade, omrade_namn: BANK.omraden[f.omrade] || '', nyckel: f.nyckel, text: f.text, varfor: varfor(f), typ: f.typ, alternativ: f.alternativ, tillval: f.tillval, inledning: f.inledning, valjare: f.valjare };
}

export function tillvalVy(t: Tillval | undefined, id: string): TillvalVy {
  const def = tillvalDef(id);
  return {
    id,
    namn: t ? tillvalNamn(t) : def?.namn || id,
    grupp: def?.grupp || 'Egna behov',
    kort: def?.kort || (t?.beskrivning ? 'Ert eget behov, med era ord.' : ''),
    digitala: def?.digitala || 'Digitala utreder behovet och föreslår en lämplig väg.',
    kostnad: def?.kostnad || 'Ännu inte utrett.',
    grans: def?.grans || 'Ett önskemål är inget köp och inget tillstånd att ändra ett konto.',
    annat: !def,
    kundval: t?.kundval ?? null,
    kundval_text: t?.kundval ? (id === 'doman' && t.kundval === 'onskat' ? 'Ni vill ha en ny domän' : id === 'doman' && t.kundval === 'har_system' ? 'Ni har redan en domän' : KUNDVAL_TEXT[t.kundval]) : null,
    system: t?.system,
    kalla: t?.kalla,
    citat: t?.citat,
    rekommendation: t?.rekommendation?.giltig && t.kundval !== 'onskat' && t.kundval !== 'har_system' && t.kundval !== 'inte_nu' ? t.rekommendation.text : null,
    digitala_status: t?.digitala ? DIGITALA_TEXT[t.digitala.status] : null,
    kontroll: t?.kontroll && (t.kundval === 'har_system' || t.kundval === 'onskat') ? { text: kontrollText(t.kontroll), tid: t.kontroll.tid, anmarkningar: t.kontroll.anmarkningar, registrerad: t.kontroll.registrerad, doman: t.kontroll.doman } : null,
  };
}

export function tillVy(a: Arende): Vy {
  const fragaText = new Map(a.fragor.map((f) => [f.id, f.text]));
  const sistaInl = a.inlamningar[a.inlamningar.length - 1];
  const oppna = a.fragor.filter((f) => f.status === 'stalld').map(fragaVy);
  const kvar = aterstar(a);
  const pausad = Boolean(a.ai.paus_till && Date.parse(a.ai.paus_till) > Date.now());
  const aiStatus = a.ai.lage === 'regelstyrd' ? 'av' : pausad ? 'pausad' : a.ai.aktuell || (a.ai.senaste_fel && !a.ai.senaste_lyckade ? 'reserv' : 'aktiv');
  const aiBeskrivning = aiStatus === 'av' ? 'AI-stöd: av. Frågorna följer vår standardlista.'
    : aiStatus === 'pausad' ? (a.ai.budget_skal ? `AI-stöd: pausat (${a.ai.budget_skal}). Era svar sparas; frågorna följer vår standardlista.` : 'AI-stöd: pausat efter upprepade fel. Era svar sparas; frågorna följer vår standardlista.')
      : aiStatus === 'reserv' ? 'AI-stöd: reservläge efter ett fel. Era svar sparas; nästa fråga följer standardlistan.'
        : a.ai.lage === 'claude-cli' ? 'AI-stöd: på (lokalt testläge med Claude). Era egna ord sparas ordagrant och skilt från AI:ns tolkningar.' : 'AI-stöd: på. Era egna ord sparas ordagrant och skilt från AI:ns tolkningar.';
  const bildRader = bild(a);
  const tillvalLista = [...TILLVAL.map((d) => tillvalVy((a.tillval || []).find((t) => t.id === d.id), d.id)), ...(a.tillval || []).filter((t) => !tillvalDef(t.id)).map((t) => tillvalVy(t, t.id))];
  const inlamnad = sistaInl && !a.fragor.some(f => f.status === 'stalld' && (f.kalla === 'returfraga' || (f.oppnad_revision || 0) > sistaInl.revision || f.stalld > sistaInl.tid)) && !a.svar.some(s => s.revision > sistaInl.revision) && !a.rattelser.some(r => r.revision > sistaInl.revision) && !a.material.some(m => m.revision > sistaInl.revision) && !(a.tillval || []).some(t => t.revision > sistaInl.revision) ? { tid: sistaInl.tid, svar: sistaInl.svar, material: sistaInl.material } : null;
  const hamtad = Boolean(a.signal && a.kvittenser?.some(k => k.signal_id === a.signal!.id));
  const overforing: Vy['overforing'] = !sistaInl ? 'ej_inlamnat' : hamtad ? 'hamtat' : inlamnad ? 'vantar' : 'andrat_efter';
  const t = tackning(a);
  const forstattGrupper = new Map<string, BildRad[]>();
  for (const r of bildRader.filter((x) => x.avsnitt !== 'mal')) forstattGrupper.set(r.omrade, [...(forstattGrupper.get(r.omrade) || []), r]);
  return {
    tackning: t,
    behov: behovMedStatus(a).map(b => ({ id:b.id, nyckel:b.nyckel, citat:b.citat, status:b.status, kan_oppnas:a.fragor.some(f => f.id === b.id && f.status !== 'stalld') && b.status !== 'besvarad' })),
    overlamning: overforing === 'hamtat' ? 'Aktuell inlämning har hämtats av Digitala. Bearbetningen sker i nästa arbetssteg.' : overforing === 'vantar' ? 'Inlämnat och sparat hos oss. Väntar på att hämtas av Digitala.' : overforing === 'andrat_efter' ? 'Ni har ändrat något efter inlämningen. Ändringen är sparad och följer med när Digitala hämtar nästa gång.' : 'Sparat hos oss. Ännu inte inlämnat.',
    overforing,
    arende: { id: a.id, kund: { namn: a.kund.namn }, testdialog: a.testdialog, revision: a.revision, kanal: a.kanal, inlamnad, uppdaterad: a.uppdaterad },
    ai: { lage: a.ai.lage, modell: a.ai.lage === 'regelstyrd' ? undefined : a.ai.modell, anrop: a.ai.anrop, status: aiStatus, beskrivning: aiBeskrivning },
    oppna,
    senare: a.fragor.filter((f) => f.status === 'senare').map(fragaVy),
    samtal: a.fragor.filter((f) => f.status !== 'tackt').map((f) => {
      const svar = a.svar.filter((s) => s.fraga_id === f.id);
      const s = svar[svar.length - 1];
      return { fraga_id: f.id, fraga: f.text, inledning: f.inledning, valjare: f.valjare, kalla: f.kalla, stalld: f.stalld, status: f.status, svar: s ? { text: s.text, typ: s.typ, tid: s.mottaget, andrad: svar.length - 1 } : undefined };
    }),
    dialog: [...new Map(a.svar.map((s) => [s.fraga_id, s])).values()].map((s) => ({ fraga_id: s.fraga_id, fraga: fragaText.get(s.fraga_id) || s.fraga_id, svar: s.text, typ: s.typ, tid: s.mottaget, nyckel: s.nyckel, andrad: a.svar.filter((x) => x.fraga_id === s.fraga_id).length - 1 })),
    bild: bildRader,
    uppdrag: {
      mal: bildRader.filter((r) => r.avsnitt === 'mal'),
      forstatt: [...forstattGrupper.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([omrade, rader]) => ({ omrade, namn: OMRADEN[omrade] || OMRADEN[''], rader })),
      valda: tillvalLista.filter((x) => x.kundval && x.kundval !== 'inte_nu'),
      rekommenderade: tillvalLista.filter((x) => x.rekommendation && !x.kundval),
      aterstar: t.filter((x) => x.status === 'inte_undersokt' || x.status === 'kunden_vet_inte' || x.status === 'atkomst_saknas' || x.status === 'aterkom_senare').sort((x, y) => x.prio - y.prio).slice(0, 12).map((x) => ({ nyckel: x.nyckel, fraga: x.fraga, status: x.status, prio: x.prio })),
      research: (a.research || []).map((r) => ({ id: r.id, fraga: r.fraga, varfor: r.varfor })),
      senare: [
        ...a.fragor.filter((f) => f.status === 'senare').map((f) => ({ id: f.id, text: f.text })),
        // Behov som tolkats som täckta av ett svar kan kunden följa upp med en egen fråga.
        ...behovMedStatus(a).filter((b) => b.status === 'tackt' && a.fragor.some((f) => f.id === b.id && f.status !== 'stalld' && f.status !== 'senare')).map((b) => ({ id: b.id, text: b.fraga, not: `Tolkat från era ord: ”${b.citat}”` })),
      ],
    },
    tillval: tillvalLista,
    grupper: [...GRUPPER, 'Egna behov'],
    material: a.material.filter((m) => m.status === 'mottagen').map((m) => ({ id: m.id, typ: m.typ, filnamn: m.filnamn, mime: m.mime, storlek: m.storlek, url: m.url, beskrivning: m.beskrivning, mottaget: m.mottaget, lasstatus: m.lasning ? 'Läst av Digitala' : m.extraktion ? 'Mottaget; texten är utläst men ännu inte genomläst av Digitala' : 'Mottaget; ännu inte läst' })),
    aterstar: kvar,
    klar: oppna.length === 0 && Boolean(a.samtal_klar),
    avslut: a.samtal_klar?.meddelande || null,
  };
}
