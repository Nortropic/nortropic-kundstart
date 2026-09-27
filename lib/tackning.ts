import { BANK } from './bank';
import type { Arende, Behov, Svar } from './typer';

// Säkerhetsnät vid modellfel: fångar tydliga ämnen över frågefälten. Fynden är öppna behov,
// aldrig påhittade faktasvar. Modellen får dessutom föreslå andra behov med ordagrant citat.
const AMNEN = [
  { nyckel: 'publiceringsvillkor', rx: /embargo|tidigast.*(?:vis|public)|innan.*offentlig|inte.*(?:visas|publiceras)|bildtillstånd|samtycke|tillstånd.*bild/iu, fraga: 'Vilka villkor behöver vara uppfyllda innan material får visas, och vem får godkänna det?' },
  { nyckel: 'delade_resurser', rx: /(?:delar|gemensam|samma|ett enda).*(?:rum|utrustning|lokal)|dubbelbok/iu, fraga: 'Vilka personer, rum eller utrustning behöver bokningen hålla ihop så att de inte används samtidigt?' },
  { nyckel: 'paminnelser', rx: /påminnel/iu, fraga: 'När behövs påminnelsen, till vem och genom vilken tillåten kontaktväg?' },
  { nyckel: 'marknadsforing', rx: /annonser|google ads|meta|marknadsför|kampanj/iu, fraga: 'Vilka ska marknadsföringen nå, i vilka kanaler och med vilken planeringsbudget? Det innebär inget tillstånd att spendera pengar.' },
] as const;

export function samlaBehov(a: Arende, s: Svar) {
  if (s.typ === 'vet_inte' || s.typ === 'ej_tillampligt' || s.typ === 'atkomst_saknas') return;
  for (const amne of AMNEN) {
    if (amne.nyckel === s.nyckel || !amne.rx.test(s.text) || a.behov?.some(b => b.nyckel === amne.nyckel)) continue;
    const citat = s.text.split(/(?<=[.!?])\s+/u).find(del => amne.rx.test(del)) || s.text;
    laggBehov(a, { nyckel: amne.nyckel, citat, fraga: amne.fraga }, s, 'regel');
  }
  // En uttrycklig sakrättelse i ett annat ämne visas direkt som kundens senare ord.
  // Hela citatet bevaras; inga numeriska värden extraheras eller gissas.
  if (s.nyckel !== 'erbjudande' && /numera|rättelse|rättar|inte längre|ändrat|ska vara|menar/iu.test(s.text) && /minuter|session|porträtt|pris|erbjud/iu.test(s.text)) {
    const citat = s.text.split(/(?<=[.!?])\s+/u).filter(del => /numera|rättelse|rättar|inte längre|ändrat|ska vara|menar/iu.test(del)).join(' ');
    if (citat && !a.rattelser.some(r => r.nyckel === 'erbjudande' && r.revision >= s.revision)) {
      a.rattelser.push({ nyckel: 'erbjudande', varde: citat, mottaget: s.mottaget, revision: s.revision, idempotens: 'amne_' + s.idempotens, tidigare: { varde: '', kalla: 'kundens sakrättelse i ' + s.fraga_id, typ: 'svar' } });
      for (const f of a.fakta_ai) if (f.nyckel === 'erbjudande') { f.giltig = false; f.forkastad_skal = 'senare uttrycklig sakrättelse över frågefält'; }
    }
  }
}

export function laggBehov(a: Arende, p: { nyckel: string; citat: string; fraga: string }, s: Svar, metod: Behov['metod']) {
  if (!/^[a-z_]{2,60}$/.test(p.nyckel) || !p.citat.trim() || !s.text.includes(p.citat) || !p.fraga.trim() || p.fraga.length > 500 || a.behov?.some(b => b.nyckel === p.nyckel || p.nyckel.startsWith(b.nyckel + '_') || (b.citat === p.citat && b.fraga === p.fraga))) return;
  const b: Behov = { ...p, id: `BEH${s.revision}_${(a.behov?.length || 0) + 1}`, kalla_fraga: s.fraga_id, revision: s.revision, status: 'oppen', metod };
  (a.behov ??= []).push(b);
}

export function tackning(a: Arende) {
  const frågor = [...BANK.grund, ...a.fragor.filter(f => f.kalla === 'returfraga' || f.kalla === 'behov')];
  return frågor.filter((f, ix, arr) => arr.findIndex(x => x.nyckel === f.nyckel) === ix).map(f => {
    const s = [...a.svar].reverse().find(s => s.nyckel === f.nyckel);
    const r = [...a.rattelser].reverse().find(r => r.nyckel === f.nyckel);
    const g = a.fragor.find(g => g.nyckel === f.nyckel);
    const status = r && (!s || r.revision > s.revision) ? 'uppgift_finns' : s?.typ === 'vet_inte' ? 'kunden_vet_inte' : s?.typ === 'ej_tillampligt' ? 'inte_tillampligt' : s?.typ === 'atkomst_saknas' ? 'atkomst_saknas' : s ? 'uppgift_finns' : a.fakta_ai.some(x => x.nyckel === f.nyckel && x.giltig) ? 'tolkning_att_kontrollera' : a.fakta_forifyllda.some(x => x.nyckel === f.nyckel && x.status !== 'okänt') ? 'forifylld_att_kontrollera' : g?.status === 'senare' ? 'aterkom_senare' : 'inte_undersokt';
    return { nyckel: f.nyckel, omrade: f.omrade, fraga: f.text, status, kalla: s ? s.fraga_id : r ? `rattelse:${r.revision}` : null };
  });
}
