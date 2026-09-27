// Vyn som kundens webbläsare får: inga lagringssökvägar, inga idempotensnycklar, ingen händelselogg.
import { aterstar, bild, type BildRad } from './arende';
import { BANK } from './bank';
import { tackning } from './tackning';
import type { Arende, Fraga } from './typer';

export interface FragaVy {
  id: string;
  omrade: string;
  omrade_namn: string;
  nyckel: string;
  text: string;
  varfor: string;
  typ: 'oppen' | 'val';
  alternativ?: string[];
  valjare: 'regelstyrd' | 'ai';
}

export interface DialogRad { fraga_id: string; fraga: string; svar: string; typ: string; tid: string; nyckel: string; andrad: number }

export interface MaterialVy { id: string; typ: 'fil' | 'lank'; filnamn?: string; mime?: string; storlek?: number; url?: string; beskrivning?: string; mottaget: string; lasstatus: string }

export interface Vy {
  arende: { id: string; kund: { namn: string }; testdialog: boolean; revision: number; kanal: string; inlamnad: { tid: string; svar: number; material: number } | null };
  ai: { lage: string; modell?: string; anrop: number; status: string; beskrivning: string };
  tackning: ReturnType<typeof tackning>;
  behov: { nyckel: string; citat: string; status: string }[];
  overlamning: string;
  oppna: FragaVy[];
  senare: FragaVy[];
  dialog: DialogRad[];
  bild: BildRad[];
  material: MaterialVy[];
  aterstar: { viktiga: number; ovriga: number };
  klar: boolean;
}

function varfor(f: Fraga): string {
  // "vad svaret påverkar" ur banken, uttryckt utan interna referenser (brief §, filnamn).
  return f.paverkar.replace(/\s*\([^)]*\)/g, '').replace(/\s*;.*$/, '').trim();
}

export function fragaVy(f: Fraga): FragaVy {
  return { id: f.id, omrade: f.omrade, omrade_namn: BANK.omraden[f.omrade] || '', nyckel: f.nyckel, text: f.text, varfor: varfor(f), typ: f.typ, alternativ: f.alternativ, valjare: f.valjare };
}

export function tillVy(a: Arende): Vy {
  const fragaText = new Map(a.fragor.map((f) => [f.id, f.text]));
  const sistaInl = a.inlamningar[a.inlamningar.length - 1];
  const oppna = a.fragor.filter((f) => f.status === 'stalld').map(fragaVy);
  const kvar = aterstar(a);
  const pausad = Boolean(a.ai.paus_till && Date.parse(a.ai.paus_till) > Date.now());
  const aiStatus = a.ai.lage === 'regelstyrd' ? 'av' : pausad ? 'pausad' : a.ai.aktuell || (a.ai.senaste_fel && !a.ai.senaste_lyckade ? 'reserv' : 'aktiv');
  const aiBeskrivning = aiStatus === 'av' ? 'AI-stöd: av. Frågorna följer vår standardlista.' : aiStatus === 'pausad' ? 'AI-stöd: pausat. Reservfrågorna används och era svar sparas.' : aiStatus === 'reserv' ? 'AI-stöd: reservläge efter ett fel. Era svar sparas; nästa fråga följer standardlistan.' : `AI-stöd: tillgängligt (${a.ai.modell || a.ai.lage}). Era ord sparas ordagrant.`;
  return {
    tackning: tackning(a), behov: (a.behov || []).map(b => ({ nyckel: b.nyckel, citat: b.citat, status: b.status })),
    overlamning: a.signal ? a.kvittenser?.some(k => k.signal_id === a.signal!.id) ? 'Aktuell inlämning har hämtats av Digitala.' : 'Sparat och väntar på att hämtas av Digitala.' : 'Ännu inte inlämnat.',
    arende: { id: a.id, kund: { namn: a.kund.namn }, testdialog: a.testdialog, revision: a.revision, kanal: a.kanal, inlamnad: sistaInl && !a.fragor.some(f => f.kalla === 'returfraga' && f.status === 'stalld') && !a.svar.some(s => s.revision > sistaInl.revision) && !a.rattelser.some(r => r.revision > sistaInl.revision) && !a.material.some(m => m.revision > sistaInl.revision) ? { tid: sistaInl.tid, svar: sistaInl.svar, material: sistaInl.material } : null },
    ai: { lage: a.ai.lage, modell: a.ai.lage === 'regelstyrd' ? undefined : a.ai.modell, anrop: a.ai.anrop, status: aiStatus, beskrivning: aiBeskrivning },
    oppna,
    senare: a.fragor.filter((f) => f.status === 'senare').map(fragaVy),
    dialog: [...new Map(a.svar.map((s) => [s.fraga_id, s])).values()].map((s) => ({ fraga_id: s.fraga_id, fraga: fragaText.get(s.fraga_id) || s.fraga_id, svar: s.text, typ: s.typ, tid: s.mottaget, nyckel: s.nyckel, andrad: a.svar.filter((x) => x.fraga_id === s.fraga_id).length - 1 })),
    bild: bild(a),
    material: a.material.filter((m) => m.status === 'mottagen').map((m) => ({ id: m.id, typ: m.typ, filnamn: m.filnamn, mime: m.mime, storlek: m.storlek, url: m.url, beskrivning: m.beskrivning, mottaget: m.mottaget, lasstatus: m.lasning ? 'Läst av Digitala' : m.extraktion ? 'Text extraherad, ännu inte läst' : 'Mottaget, ännu inte läst' })),
    aterstar: kvar,
    klar: oppna.length === 0 && kvar.viktiga + kvar.ovriga === 0,
  };
}
