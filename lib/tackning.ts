import { BANK } from './bank';
import type { Arende, Behov, Svar, Rattelse } from './typer';

// Säkerhetsnät vid modellfel: fångar tydliga ämnen över frågefälten. Fynden är öppna behov,
// aldrig påhittade faktasvar. Modellen får dessutom föreslå andra behov med ordagrant citat.
const AMNEN = [
  { nyckel: 'publiceringsvillkor', rx: /embargo|tidigast.*(?:vis|public)|innan.*offentlig|inte.*(?:visas|publiceras)|bildtillstånd|samtycke|tillstånd.*bild/iu, fraga: 'Vilka villkor behöver vara uppfyllda innan material får visas, och vem får godkänna det?' },
  { nyckel: 'delade_resurser', rx: /(?<![\p{L}\p{N}_])(?:delar|delad(?:e)?|gemensam(?:ma)?|samma|ett enda)(?![\p{L}\p{N}_])[^.!?;\n]{0,100}(?<![\p{L}\p{N}_])(?:rum(?:met)?|(?:ljus)?utrustning(?:en)?|lokal(?:en)?)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])dubbelbok(?:a|as|ning|ningar|ad|ade)?(?![\p{L}\p{N}_])/iu, fraga: 'Vilka personer, rum eller utrustning behöver bokningen hålla ihop så att de inte används samtidigt?' },
  { nyckel: 'paminnelser', rx: /påminnel/iu, fraga: 'När behövs påminnelsen, till vem och genom vilken tillåten kontaktväg?' },
  { nyckel: 'marknadsforing', rx: /(?<![\p{L}\p{N}_])(?:annonser(?:ing|a)?|google ads|meta|marknadsför(?:ing|ingen|a)?|kampanj(?:er|en)?)(?![\p{L}\p{N}_])/iu, fraga: 'Vilka ska marknadsföringen nå, i vilka kanaler och med vilken planeringsbudget? Det innebär inget tillstånd att spendera pengar.' },
] as const;

export function samlaBehov(a: Arende, s: Svar, tidigare?: Rattelse['tidigare']) {
  if (s.typ === 'vet_inte' || s.typ === 'ej_tillampligt' || s.typ === 'atkomst_saknas') return;
  for (const amne of AMNEN) {
    if (amne.nyckel === s.nyckel || !amne.rx.test(s.text) || a.behov?.some(b => b.nyckel === amne.nyckel)) continue;
    const citat = s.text.split(/(?<=[.!?])\s+/u).find(del => amne.rx.test(del)) || s.text;
    laggBehov(a, { nyckel: amne.nyckel, citat, fraga: amne.fraga }, s, 'regel');
  }
  // Endast ett uttryckligen rubricerat besked om porträttets längd får ersätta
  // ett tidigare porträtterbjudande. Övrig tvetydig text förblir källtext i svaret.
  // Ingen allmän träff på ”menar”, ”pris” eller ”session” är en kundrättelse.
  const citat = s.text.split(/(?<=[.!?])\s+/u).find(del => /^rättelse:\s*porträtt(?:sessionen|session|et)?\s+(?:är\s+)?(?:numera|nu)\s+\d{1,3}\s+minuter(?:[, .]|$)/iu.test(del));
  if (s.nyckel !== 'erbjudande' && citat && tidigare && /porträtt/iu.test(tidigare.varde) && /\d+\s+minuter/iu.test(tidigare.varde) && !/workshop|företag|bröllop/iu.test(tidigare.varde) && !a.rattelser.some(r => r.nyckel === 'erbjudande' && r.revision >= s.revision)) {
    a.rattelser.push({ nyckel: 'erbjudande', varde: citat, mottaget: s.mottaget, revision: s.revision, idempotens: 'amne_' + s.idempotens, tidigare });
    for (const f of a.fakta_ai) if (f.nyckel === 'erbjudande') { f.giltig = false; f.forkastad_skal = 'kundens uttryckliga rättelse av porträttets längd'; }
  }
}

export function laggBehov(a: Arende, p: { nyckel: string; citat: string; fraga: string }, s: Svar, metod: Behov['metod']) {
  if (!/^[a-z_]{2,60}$/.test(p.nyckel) || !p.citat.trim() || !s.text.includes(p.citat) || !p.fraga.trim() || p.fraga.length > 500 || a.behov?.some(b => b.nyckel === p.nyckel || p.nyckel.startsWith(b.nyckel + '_') || (b.citat === p.citat && b.fraga === p.fraga))) return;
  const b: Behov = { ...p, id: `BEH${s.revision}_${(a.behov?.length || 0) + 1}`, kalla_fraga: s.fraga_id, revision: s.revision, status: 'oppen', metod };
  (a.behov ??= []).push(b);
}

/** Härledd status håller även äldre dokument med felaktigt öppen AI-täckning sann. */
export function behovStatus(a: Arende, b: Behov): Behov['status'] {
  const f = a.fragor.find(f => f.id === b.id);
  if (f?.status === 'stalld' || f?.status === 'senare') return 'oppen';
  const svar = [...a.svar].reverse().find(s => s.nyckel === b.nyckel);
  const rattelse = [...a.rattelser].reverse().find(r => r.nyckel === b.nyckel);
  if (rattelse && (!svar || rattelse.revision > svar.revision)) return 'besvarad';
  if (svar) return svar.typ === 'vet_inte' || svar.typ === 'atkomst_saknas' ? 'oppen' : 'besvarad';
  if (f?.status === 'tackt' && a.fakta_ai.some(f => f.nyckel === b.nyckel && f.giltig)) return 'tackt';
  return 'oppen';
}
export function behovMedStatus(a: Arende) { return (a.behov || []).map(b => ({ ...b, status: behovStatus(a, b) })); }

export function tackning(a: Arende) {
  const frågor = [...BANK.grund, ...(a.behov || []).map(b => ({nyckel:b.nyckel,omrade:'H',text:b.fraga})), ...a.fragor.filter(f => f.kalla === 'returfraga' || f.kalla === 'behov')];
  return frågor.filter((f, ix, arr) => arr.findIndex(x => x.nyckel === f.nyckel) === ix).map(f => {
    const s = [...a.svar].reverse().find(s => s.nyckel === f.nyckel);
    const r = [...a.rattelser].reverse().find(r => r.nyckel === f.nyckel);
    const g = a.fragor.find(g => g.nyckel === f.nyckel);
    const status = r && (!s || r.revision > s.revision) ? 'uppgift_finns' : s?.typ === 'vet_inte' ? 'kunden_vet_inte' : s?.typ === 'ej_tillampligt' ? 'inte_tillampligt' : s?.typ === 'atkomst_saknas' ? 'atkomst_saknas' : s ? 'uppgift_finns' : a.fakta_ai.some(x => x.nyckel === f.nyckel && x.giltig) ? 'tolkning_att_kontrollera' : a.fakta_forifyllda.some(x => x.nyckel === f.nyckel && x.status !== 'okänt') ? 'forifylld_att_kontrollera' : g?.status === 'senare' ? 'aterkom_senare' : 'inte_undersokt';
    return { nyckel: f.nyckel, omrade: f.omrade, fraga: f.text, status, kalla: r && (!s || r.revision > s.revision) ? `rattelse:${r.revision}` : s?.fraga_id || null };
  });
}
