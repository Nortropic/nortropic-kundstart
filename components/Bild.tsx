'use client';
import { useState } from 'react';
import { AnropsFel, anropa, klockslag, nyNyckel } from '@/lib/klient';
import type { Vy } from '@/lib/vy';
import type { BildRad } from '@/lib/arende';

const OMRADEN: Record<string, string> = { A: 'Verksamhet, mål och erbjudande', B: 'Besökare och situationer', C: 'Hur ni arbetar', D: 'System och åtkomster', E: 'Varumärke, innehåll och förtroende', F: 'Synlighet och mätning', G: 'Förvaltning', H: 'Ramar och osäkerheter', '': 'Övrigt' };

export default function Bild({ vy, setVy }: { vy: Vy; setVy: (v: Vy) => void }) {
  const grupper = new Map<string, BildRad[]>();
  for (const r of vy.bild) grupper.set(r.omrade, [...(grupper.get(r.omrade) || []), r]);
  const vetInte = vy.dialog.filter((d) => d.typ === 'vet_inte');
  return (
    <div>
      <h1>Vår bild av er</h1>
      <p>Det här är vad vi tror oss veta just nu. Det ni själva uppgett står som ni skrev det. Där AI-stödet har sammanfattat står det som en tolkning, och den kan ni rätta.</p>
      {vy.bild.length === 0 && <p className="dis">Inget ännu. Bilden växer fram medan ni svarar i samtalet.</p>}
      {[...grupper.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([omrade, rader]) => (
        <section className="bild-omrade" key={omrade || 'ovrigt'}>
          <h2>{OMRADEN[omrade] || OMRADEN['']}</h2>
          {rader.map((r) => (
            <Rad key={r.nyckel} rad={r} setVy={setVy} />
          ))}
        </section>
      ))}
      {(vetInte.length > 0 || vy.senare.length > 0) && (
        <section className="bild-omrade">
          <h2>Det ni inte visste eller ville återkomma om</h2>
          {vetInte.map((d) => (
            <div className="bild-rad" key={'vi-' + d.fraga_id}>
              <span className="rubrik">{d.fraga}</span>
              <p className="varde dis">Vet inte</p>
            </div>
          ))}
          {vy.senare.map((s) => (
            <div className="bild-rad" key={'se-' + s.id}>
              <span className="rubrik">{s.text}</span>
              <p className="varde dis">Ni återkommer om detta</p>
            </div>
          ))}
        </section>
      )}
      {!vy.klar && (
        <p className="aterstar">
          Det som återstår i samtalet: {vy.aterstar.viktiga} {vy.aterstar.viktiga === 1 ? 'fråga' : 'frågor'} som påverkar lösningen{vy.aterstar.ovriga > 0 ? ` och ${vy.aterstar.ovriga} mindre` : ''}.
        </p>
      )}
    </div>
  );
}

function Rad({ rad, setVy }: { rad: BildRad; setVy: (v: Vy) => void }) {
  const [oppen, setOppen] = useState(false);
  const [text, setText] = useState(rad.varde);
  const [idempotens] = useState(() => nyNyckel());
  const [lage, setLage] = useState<'' | 'sparar' | 'fel'>('');
  const [fel, setFel] = useState('');
  async function spara() {
    setLage('sparar');
    setFel('');
    try {
      const r = await anropa<{ ok: true; vy: Vy }>('/api/rattelse', { method: 'POST', body: JSON.stringify({ nyckel: rad.nyckel, varde: text, idempotens }) });
      setVy(r.vy);
      setOppen(false);
      setLage('');
    } catch (e) {
      setLage('fel');
      setFel((e as AnropsFel).message);
    }
  }
  const ursprung = rad.typ === 'kund' ? `Ni uppgav detta ${klockslag(rad.tid)}` : rad.typ === 'ai' ? 'Vår tolkning av det ni sagt. Rätta gärna om det inte stämmer.' : `Från ${rad.kalla}. Rätta gärna om det inte stämmer.`;
  return (
    <div className="bild-rad">
      <span className="rubrik">{rad.rubrik}</span>
      <p className="varde">{rad.varde}</p>
      <span className={'ursprung' + (rad.typ === 'ai' ? ' ai' : '')}>{ursprung}</span>
      {!oppen ? (
        <div className="rattning">
          <button type="button" className="knapp lank" onClick={() => { setText(rad.varde); setOppen(true); }}>Ändra</button>
        </div>
      ) : (
        <div className="rattning">
          <label className="sr" htmlFor={'ratt-' + rad.nyckel}>Rätta {rad.rubrik}</label>
          <textarea id={'ratt-' + rad.nyckel} className="ratt-falt" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="rad">
            <button type="button" className="knapp" onClick={() => void spara()} disabled={lage === 'sparar' || !text.trim() || text.trim() === rad.varde}>{lage === 'sparar' ? 'Sparar …' : 'Spara rättelse'}</button>
            <button type="button" className="knapp lank" onClick={() => setOppen(false)}>Avbryt</button>
          </div>
          {fel && <p className="not fel" role="alert">{fel}</p>}
        </div>
      )}
    </div>
  );
}
