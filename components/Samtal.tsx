'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnropsFel, anropa, klockslag, lasUtkast, nyNyckel, sparaUtkast } from '@/lib/klient';
import type { FragaVy, Vy } from '@/lib/vy';

type NastaSvar = { ok: true; klar: boolean; meddelande: string; ai: { lage: string; anvand: boolean; fallback: boolean; fel?: string; modell?: string }; fragor: FragaVy[]; vy: Vy };
type SvarSvar = { ok: true; ny: boolean; sparat: string; vy: Vy };

export default function Samtal({ vy, setVy, gaTill }: { vy: Vy; setVy: (v: Vy) => void; gaTill: (f: 'samtal' | 'bild' | 'material') => void }) {
  const [hamtar, setHamtar] = useState(false);
  const [hamtFel, setHamtFel] = useState('');
  const [aiNot, setAiNot] = useState('');
  const [meddelande, setMeddelande] = useState('');
  const [inlamnar, setInlamnar] = useState(false);
  const [sparat, setSparat] = useState('');
  const hamtarRef = useRef(false);
  const fragaRef = useRef<HTMLHeadingElement | null>(null);

  const hamtaNasta = useCallback(async () => {
    if (hamtarRef.current) return;
    hamtarRef.current = true;
    setHamtar(true);
    setHamtFel('');
    try {
      const r = await anropa<NastaSvar>('/api/nasta', { method: 'POST' });
      setVy(r.vy);
      setMeddelande(r.ai.anvand ? r.meddelande : '');
      setAiNot(r.ai.fallback ? 'AI-stödet nåddes inte just nu, så nästa fråga följer vår standardlista. Era svar är sparade.' : '');
      setSparat('');
      setTimeout(() => fragaRef.current?.focus(), 50);
    } catch (e) {
      setHamtFel((e as AnropsFel).message);
    } finally {
      hamtarRef.current = false;
      setHamtar(false);
    }
  }, [setVy]);

  useEffect(() => {
    if (vy.oppna.length === 0 && !vy.klar && !vy.arende.inlamnad && !hamtarRef.current) void hamtaNasta();
  }, [vy.oppna.length, vy.klar, vy.arende.inlamnad, hamtaNasta]);

  async function lamnaIn() {
    setInlamnar(true);
    try {
      const r = await anropa<{ ok: true; vy: Vy }>('/api/inlamning', { method: 'POST' });
      setVy(r.vy);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setHamtFel((e as AnropsFel).message);
    } finally {
      setInlamnar(false);
    }
  }

  const forsta = vy.dialog.length === 0 && !vy.arende.inlamnad;
  const kvar = vy.aterstar;

  return (
    <div>
      {vy.arende.inlamnad ? (
        <Bekraftelse vy={vy} gaTill={gaTill} />
      ) : forsta ? (
        <div className="inledning">
          <h1>Hej, {vy.arende.kund.namn}.</h1>
          <p>Vi vill förstå er verksamhet innan vi bygger något: vad ni vill uppnå, vilka som hör av sig och hur ni arbetar. Ni svarar i er egen takt, i era egna ord; det går bra att svara ”vet inte”. Allt sparas så att ni kan fortsätta senare.</p>
          {vy.bild.length > 0 && (
            <>
              <h3>Det här vet vi redan</h3>
              <div className="kant-lista">
                {vy.bild.slice(0, 6).map((b) => (
                  <div className="kant" key={b.nyckel}>
                    <span className="rubrik">{b.rubrik}</span>
                    <span className="varde">{b.varde}</span>
                    <span className="kalla">{b.typ === 'forifylld' ? 'Från ' + b.kalla : b.typ === 'kund' ? 'Ni har uppgett' : 'Vår tolkning'}</span>
                  </div>
                ))}
              </div>
              <p className="liten dis" style={{ marginTop: '0.5rem' }}>
                Stämmer något inte? <button type="button" className="knapp lank" style={{ minHeight: 0, padding: 0 }} onClick={() => gaTill('bild')}>Rätta under Vår bild av er</button>.
              </p>
            </>
          )}
        </div>
      ) : null}

      {!vy.arende.inlamnad && vy.dialog.length > 0 && (
        <>
          <h2 className="sr">Det ni svarat hittills</h2>
          <ol className="dialog" aria-label="Det ni svarat hittills">
            {vy.dialog.map((d, i) => (
              <li key={d.fraga_id + i}>
                <p className="fraga">{d.fraga}</p>
                <p className={'svar' + (d.typ === 'vet_inte' ? ' vet-inte' : '')}>{d.svar}</p>
              </li>
            ))}
          </ol>
        </>
      )}

      {!vy.arende.inlamnad && vy.oppna.map((f, i) => (
        <FragaKort key={f.id} fraga={f} arendeId={vy.arende.id} meddelande={i === 0 ? meddelande : ''} rubrikRef={i === 0 ? fragaRef : undefined} onSparat={(v, tid) => { setVy(v); setMeddelande(''); setSparat(tid); }} />
      ))}

      {sparat && <p className="status sparat" role="status" aria-live="polite">Sparat {sparat}</p>}
      {aiNot && <p className="not varn" role="status">{aiNot}</p>}
      {hamtar && <p className="status" role="status">Väntar på nästa fråga …</p>}
      {hamtFel && (
        <p className="not fel" role="alert">
          {hamtFel} <button type="button" className="knapp lank" onClick={() => void hamtaNasta()}>Försök igen</button>
        </p>
      )}

      {!vy.arende.inlamnad && vy.klar && !hamtar && (
        <div className="aktuell">
          <h2>Det räcker för nu</h2>
          <p>Tack. Det ni berättat räcker för att vi ska kunna gå vidare. Titta gärna igenom <button type="button" className="knapp lank" style={{ minHeight: 0, padding: 0 }} onClick={() => gaTill('bild')}>vår bild av er</button> och lägg till <button type="button" className="knapp lank" style={{ minHeight: 0, padding: 0 }} onClick={() => gaTill('material')}>material</button> om ni har något, och lämna sedan in genomgången.</p>
          {vy.senare.length > 0 && <p className="liten dis">Ni ville återkomma om: {vy.senare.map((s) => s.text).join(' ')}</p>}
          <div className="rad">
            <button type="button" className="knapp" onClick={() => void lamnaIn()} disabled={inlamnar}>{inlamnar ? 'Lämnar in …' : 'Lämna in genomgången'}</button>
          </div>
        </div>
      )}

      {!vy.arende.inlamnad && !vy.klar && (
        <p className="aterstar">
          {kvar.viktiga > 0 ? `Kvar just nu: ${kvar.viktiga} ${kvar.viktiga === 1 ? 'fråga' : 'frågor'} som påverkar lösningen` : 'Inga fler frågor som påverkar lösningen just nu'}
          {kvar.ovriga > 0 ? `, och ${kvar.ovriga} mindre.` : '.'}
          {vy.dialog.length > 0 && (
            <>
              {' '}Ni kan också <button type="button" className="knapp lank" style={{ minHeight: 0, padding: 0 }} onClick={() => void lamnaIn()} disabled={inlamnar}>lämna in det ni har hittills</button>.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function FragaKort({ fraga, arendeId, meddelande, rubrikRef, onSparat }: { fraga: FragaVy; arendeId: string; meddelande: string; rubrikRef?: React.MutableRefObject<HTMLHeadingElement | null>; onSparat: (v: Vy, tid: string) => void }) {
  const nyckel = arendeId + ':' + fraga.id;
  const [text, setText] = useState('');
  const [idempotens, setIdempotens] = useState('');
  const [val, setVal] = useState('');
  const [lage, setLage] = useState<'tom' | 'osparad' | 'sparar' | 'sparat' | 'fel'>('tom');
  const [fel, setFel] = useState('');

  useEffect(() => {
    const u = lasUtkast(nyckel);
    if (u) {
      setText(u.text);
      setIdempotens(u.idempotens);
      if (u.text) setLage('osparad');
    }
  }, [nyckel]);

  function andra(t: string) {
    setText(t);
    const id = idempotens || nyNyckel();
    if (!idempotens) setIdempotens(id);
    sparaUtkast(nyckel, { text: t, idempotens: id });
    setLage(t.trim() ? 'osparad' : 'tom');
  }

  async function skicka(typ: 'text' | 'vet_inte' | 'val') {
    if (lage === 'sparar') return;
    const innehall = typ === 'val' ? val : text;
    if (typ !== 'vet_inte' && !innehall.trim()) return;
    const id = idempotens || nyNyckel();
    setIdempotens(id);
    setLage('sparar');
    setFel('');
    try {
      const r = await anropa<SvarSvar>('/api/svar', { method: 'POST', body: JSON.stringify({ fraga_id: fraga.id, text: innehall, typ, idempotens: typ === 'vet_inte' ? nyNyckel() : id }) });
      sparaUtkast(nyckel, null);
      setLage('sparat');
      onSparat(r.vy, klockslag(r.sparat));
    } catch (e) {
      const f = e as AnropsFel;
      setLage('fel');
      setFel(f.message);
      if (f.status === 401) window.location.href = '/lank?skal=session';
    }
  }

  async function senare() {
    try {
      const r = await anropa<{ ok: true; vy: Vy }>('/api/senare', { method: 'POST', body: JSON.stringify({ fraga_id: fraga.id }) });
      sparaUtkast(nyckel, null);
      onSparat(r.vy, '');
    } catch (e) {
      setLage('fel');
      setFel((e as AnropsFel).message);
    }
  }

  const statusText = lage === 'sparar' ? 'Sparar …' : lage === 'osparad' ? 'Inte sparat än' : lage === 'sparat' ? 'Sparat' : '';

  return (
    <div className="aktuell">
      {meddelande && <p className="meddelande">{meddelande}</p>}
      <h2 className="fragetext" ref={rubrikRef} tabIndex={-1}>{fraga.text}</h2>
      {fraga.varfor && <p className="varfor">Varför vi frågar: {fraga.varfor}.</p>}
      {fraga.typ === 'val' && fraga.alternativ ? (
        <div className="alternativ" role="group" aria-label="Alternativ">
          {fraga.alternativ.map((a) => (
            <button type="button" key={a} aria-pressed={val === a} onClick={() => setVal(a)}>{a}</button>
          ))}
        </div>
      ) : null}
      <label className="sr" htmlFor={'svar-' + fraga.id}>Ert svar</label>
      <textarea id={'svar-' + fraga.id} className="svar-falt" value={text} onChange={(e) => andra(e.target.value)} placeholder={fraga.typ === 'val' ? 'Eller skriv med egna ord' : 'Skriv med egna ord'} enterKeyHint="done" autoCapitalize="sentences" />
      <div className="rad">
        <button type="button" className="knapp" onClick={() => void skicka(fraga.typ === 'val' && val && !text.trim() ? 'val' : 'text')} disabled={lage === 'sparar' || (!text.trim() && !val)}>{lage === 'sparar' ? 'Sparar …' : 'Spara svar'}</button>
        <button type="button" className="knapp sekundar" onClick={() => void skicka('vet_inte')} disabled={lage === 'sparar'}>Vet inte</button>
        <button type="button" className="knapp lank" onClick={() => void senare()} disabled={lage === 'sparar'}>Återkom senare</button>
      </div>
      <p className={'status ' + lage} role="status" aria-live="polite">{statusText}</p>
      {fel && (
        <p className="not fel" role="alert">
          {fel} <button type="button" className="knapp lank" onClick={() => void skicka('text')}>Försök igen</button>
        </p>
      )}
    </div>
  );
}

function Bekraftelse({ vy, gaTill }: { vy: Vy; gaTill: (f: 'samtal' | 'bild' | 'material') => void }) {
  const i = vy.arende.inlamnad!;
  return (
    <div className="bekraftelse">
      <h1>Tack, {vy.arende.kund.namn}.</h1>
      <p>Det här har ni lämnat {klockslag(i.tid)}:</p>
      <ul>
        <li>{i.svar} {i.svar === 1 ? 'svar' : 'svar'} i samtalet</li>
        <li>{i.material} {i.material === 1 ? 'fil eller länk' : 'filer och länkar'}</li>
        <li>{vy.bild.filter((b) => b.typ === 'ai').length} tolkningar från AI-stödet, som ni kan rätta</li>
      </ul>
      <h3>Vad som händer nu</h3>
      <p>Digitala hos Nortropic läser igenom det ni lämnat och undersöker vidare på egen hand. Behöver vi fråga något mer samlar vi frågorna och hör av oss genom {vy.arende.kanal === 'Kundstart-länk' ? 'den kontaktväg ni har med oss' : vy.arende.kanal}.</p>
      <p className="dis liten">Det här är en inlämning av underlag, inte ett godkännande av en design eller ett avtal om fler tjänster. Ni kan öppna länken igen och ändra eller lägga till; det ni ändrar efter inlämningen syns för oss.</p>
      <div className="rad">
        <button type="button" className="knapp sekundar" onClick={() => gaTill('bild')}>Se vår bild av er</button>
        <button type="button" className="knapp sekundar" onClick={() => gaTill('material')}>Lägg till material</button>
      </div>
    </div>
  );
}
