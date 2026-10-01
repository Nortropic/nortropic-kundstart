// Överlämningen finns i samma ETag-skyddade dokument som kundens ändring.
// Listning kan köras igen från början efter avbrott; kvittens stänger bara exakt signal.
import { list } from '@vercel/blob';
import { lasDok, uppdateraDok } from './lagring';
import type { Arende, Signal } from './typer';
import { Vagrad, nu, sattFas } from './arende';
import { serUtSomHemlighet } from './bank';

export function signalera(a: Arende, typ: Signal['typ'] = 'komplettering') {
  if (typ !== 'inlamning' && !a.inlamningar.length) return;
  a.signal = { id: `${a.id}:${a.revision}`, arende_id: a.id, kund: a.kund, revision: a.revision, typ, skapad: nu() };
}

export async function signaler(cursor?: string) {
  const sida = await list({ prefix: 'arenden/', cursor, limit: 100 });
  const signaler: Signal[] = [];
  for (const blob of sida.blobs) {
    const r = await lasDok<Arende>(blob.pathname);
    const a = r?.data;
    if (a?.signal && !a.kvittenser?.some(k => k.signal_id === a.signal!.id)) signaler.push(a.signal);
  }
  return { schema: 'kundstart-signaler/1', signaler, cursor: sida.hasMore ? sida.cursor : null };
}

/** Intern översikt för ägarens arbetsplats: bara metadata per ärende, aldrig kundtext, svar, material eller länkar. */
export interface ArendeRad {
  id: string;
  kund: string;
  testdialog: boolean;
  skapad: string;
  uppdaterad: string;
  revision: number;
  svar: number;
  material: number;
  senaste_inlamning: { tid: string; revision: number; svar: number; material: number } | null;
  andrat_efter_inlamning: boolean;
}
export async function arendelista(cursor?: string) {
  const sida = await list({ prefix: 'arenden/', cursor, limit: 100 });
  const arenden: ArendeRad[] = [];
  let olasbara = 0;  // ett trasigt dokument fäller aldrig listan för de andra; det räknas i stället
  for (const blob of sida.blobs) {
    let a: Arende | undefined;
    try { a = (await lasDok<Arende>(blob.pathname))?.data; } catch { olasbara++; continue; }
    if (!a || a.schema !== 'kundstart-arende/1' || !a.kund || !Array.isArray(a.svar) || !Array.isArray(a.material)) { olasbara++; continue; }
    const inl = a.inlamningar?.length ? a.inlamningar[a.inlamningar.length - 1] : null;
    arenden.push({
      id: a.id, kund: a.kund.namn, testdialog: !!a.testdialog, skapad: a.skapad, uppdaterad: a.uppdaterad, revision: a.revision,
      svar: a.svar.length, material: a.material.length,
      senaste_inlamning: inl ? { tid: inl.tid, revision: inl.revision, svar: inl.svar, material: inl.material } : null,
      andrat_efter_inlamning: !!inl && a.revision > inl.revision,
    });
  }
  return { schema: 'kundstart-arenden/1', arenden, olasbara, cursor: sida.hasMore ? sida.cursor : null };
}

function ansvar(v: string) { return typeof v === 'string' && /^[a-zA-Z0-9_.@/-]{2,120}$/.test(v); }
export async function kvittera(id: string, p: { signal_id: string; revision: number; utforare: string; import_sha256: string }) {
  if (!ansvar(p.utforare) || !/^[a-f0-9]{64}$/.test(p.import_sha256 || '')) throw new Vagrad('utförare och importens sha256 krävs');
  return (await uppdateraDok<Arende>(`arenden/${id}.json`, a => {
    const gammal = a.kvittenser?.find(k => k.signal_id === p.signal_id);
    if (gammal) {
      if (gammal.revision !== p.revision || gammal.import_sha256 !== p.import_sha256 || gammal.utforare !== p.utforare) throw new Vagrad('signalen har redan en annan kvittens', 409);
      return null;
    }
    if (a.signal?.id !== p.signal_id || a.signal.revision !== p.revision) throw new Vagrad('nyare kunduppgifter finns; hämta om före kvittens', 409);
    (a.kvittenser ??= []).push({ ...p, tid: nu() });
    return a; // Administrativ kvittens ändrar inte kundrevisionen.
  })).data;
}

export async function returfragor(id: string, p: { idempotens: string; bas_revision: number; utforare: string; fragor: { nyckel: string; text: string; paverkar: string }[] }) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.idempotens || '') || !ansvar(p.utforare) || !Array.isArray(p.fragor) || p.fragor.length < 1 || p.fragor.length > 6) throw new Vagrad('1–6 frågor, utförare och idempotensnyckel krävs');
  for (const f of p.fragor) if (!/^[a-z_]{2,60}$/.test(f.nyckel || '') || !f.text?.trim() || f.text.length > 500 || !f.paverkar?.trim() || f.paverkar.length > 500 || serUtSomHemlighet(f.text + f.paverkar)) throw new Vagrad('ogiltig returfråga');
  return (await uppdateraDok<Arende>(`arenden/${id}.json`, a => {
    const redan = a.returfragor?.find(r => r.idempotens === p.idempotens);
    if (redan) {
      const gamla = redan.fragor.map(fid => a.fragor.find(f => f.id === fid)).map(f => ({ nyckel: f?.nyckel, text: f?.text, paverkar: f?.paverkar }));
      if (redan.utforare !== p.utforare || redan.bas_revision !== p.bas_revision || JSON.stringify(gamla) !== JSON.stringify(p.fragor)) throw new Vagrad('idempotensnyckeln används för andra frågor', 409);
      return null;
    }
    if (a.revision !== p.bas_revision) throw new Vagrad('kundärendet har ändrats; hämta aktuell export först', 409);
    a.revision++; a.uppdaterad = nu(); a.omgang++;
    const ids: string[] = [];
    for (const [index, f] of p.fragor.entries()) {
      const fid = `RET${a.revision}_${index + 1}`; ids.push(fid);
      a.fragor.push({ ...f, id: fid, omrade: 'H', kalla: 'returfraga', typ: 'oppen', omgang: a.omgang, stalld: nu(), status: 'stalld', valjare: 'regelstyrd' });
    }
    (a.returfragor ??= []).push({ idempotens: p.idempotens, bas_revision: p.bas_revision, utforare: p.utforare, fragor: ids, tid: nu() });
    sattFas(a, 'intervju', 'digitala'); // returfrågorna besvaras i samtalet; därefter går kunden tillbaka till granskningen
    a.handelser.push({ typ: 'returfragor', tid: nu(), revision: a.revision, detaljer: { utforare: p.utforare, fragor: ids } });
    return a;
  })).data;
}

export async function materialLast(id: string, mid: string, p: { sha256: string; utforare: string; resultat: string }) {
  if (!ansvar(p.utforare) || !p.resultat?.trim() || p.resultat.length > 1000 || !/^[a-f0-9]{64}$/.test(p.sha256 || '')) throw new Vagrad('källhash, utförare och faktiskt läsresultat krävs');
  return (await uppdateraDok<Arende>(`arenden/${id}.json`, a => {
    const m = a.material.find(m => m.id === mid && m.status === 'mottagen');
    if (!m) throw new Vagrad('materialet finns inte', 404);
    if (m.sha256 !== p.sha256) throw new Vagrad('läsningen gäller annat material', 409);
    m.lasning = { ...p, tid: nu() }; return a;
  })).data;
}
