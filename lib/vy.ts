// Vyn som kundens webbläsare får: inga lagringssökvägar, inga idempotensnycklar, ingen händelselogg.
import { aterstar, bild, type BildRad } from './arende';
import { BANK } from './bank';
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

export interface MaterialVy { id: string; typ: 'fil' | 'lank'; filnamn?: string; mime?: string; storlek?: number; url?: string; beskrivning?: string; mottaget: string }

export interface Vy {
  arende: { id: string; kund: { namn: string }; testdialog: boolean; revision: number; kanal: string; inlamnad: { tid: string; svar: number; material: number } | null };
  ai: { lage: string; modell?: string; anrop: number };
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
  return {
    arende: { id: a.id, kund: { namn: a.kund.namn }, testdialog: a.testdialog, revision: a.revision, kanal: a.kanal, inlamnad: sistaInl && sistaInl.revision === a.revision ? { tid: sistaInl.tid, svar: sistaInl.svar, material: sistaInl.material } : null },
    ai: { lage: a.ai.lage, modell: a.ai.lage === 'regelstyrd' ? undefined : a.ai.modell, anrop: a.ai.anrop },
    oppna,
    senare: a.fragor.filter((f) => f.status === 'senare').map(fragaVy),
    dialog: [...new Map(a.svar.map((s) => [s.fraga_id, s])).values()].map((s) => ({ fraga_id: s.fraga_id, fraga: fragaText.get(s.fraga_id) || s.fraga_id, svar: s.text, typ: s.typ, tid: s.mottaget, nyckel: s.nyckel, andrad: a.svar.filter((x) => x.fraga_id === s.fraga_id).length - 1 })),
    bild: bild(a),
    material: a.material.filter((m) => m.status === 'mottagen').map((m) => ({ id: m.id, typ: m.typ, filnamn: m.filnamn, mime: m.mime, storlek: m.storlek, url: m.url, beskrivning: m.beskrivning, mottaget: m.mottaget })),
    aterstar: kvar,
    klar: oppna.length === 0 && kvar.viktiga + kvar.ovriga === 0,
  };
}
