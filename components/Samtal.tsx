'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnropsFel, anropa, klockslag, lasUtkast, nyNyckel, sparaUtkast } from '@/lib/klient';
import type { Svar } from '@/lib/typer';
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
      setAiNot(r.vy.ai.status === 'reserv' || r.vy.ai.status === 'pausad' ? r.vy.ai.beskrivning : '');
      setSparat('');
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

  // Ny fråga på plats: flytta fokus till rubriken (skärmläsare och tangentbord), men inte vid första renderingen.
  const forstaFragaId = vy.oppna[0]?.id;
  const forstaRendering = useRef(true);
  useEffect(() => {
    if (forstaRendering.current) {
      forstaRendering.current = false;
      return;
    }
    if (forstaFragaId) fragaRef.current?.focus();
  }, [forstaFragaId]);

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
                <p className={'svar' + (d.typ === 'vet_inte' ? ' vet-inte' : '')}>{d.svar}{d.andrad > 0 ? <span className="tyst liten"> (ändrat)</span> : null}</p>
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

      {vy.dialog.length > 0 && <Tackningsbild vy={vy} />}
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
  const router = useRouter();
  const nyckel = arendeId + ':' + fraga.id;
  const [text, setText] = useState('');
  const [idempotens, setIdempotens] = useState('');
  const [val, setVal] = useState('');
  const [lage, setLage] = useState<'tom' | 'osparad' | 'sparar' | 'sparat' | 'fel'>('tom');
  const [fel, setFel] = useState('');
  const [senasteTyp, setSenasteTyp] = useState<Svar['typ']>('text');

  useEffect(() => {
    const u = lasUtkast(nyckel);
    if (u) {
      // sessionStorage är extern browserstatus; utkast återställs efter hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  async function skicka(typ: Svar['typ']) {
    if (lage === 'sparar') return;
    setSenasteTyp(typ);
    const innehall = typ === 'val' ? val : text;
    if (typ !== 'vet_inte' && !innehall.trim()) return;
    // En nyckel per fråga och försök: samma nyckel vid återförsök, så ett återförsök eller dubbelklick aldrig ger två rader.
    const id = idempotens || nyNyckel();
    if (!idempotens) {
      setIdempotens(id);
      sparaUtkast(nyckel, { text, idempotens: id });
    }
    setLage('sparar');
    setFel('');
    try {
      const r = await anropa<SvarSvar>('/api/svar', { method: 'POST', body: JSON.stringify({ fraga_id: fraga.id, text: innehall, typ, idempotens: id }) });
      sparaUtkast(nyckel, null);
      setLage('sparat');
      // ny:false = svaret var redan sparat (samma nyckel eller samma text): vyn från servern gäller, inget tappas
      onSparat(r.vy, r.ny ? klockslag(r.sparat) : 'tidigare');
    } catch (e) {
      const f = e as AnropsFel;
      setLage('fel');
      setFel(f.message);
      if (f.status === 401) router.push('/lank?skal=session');
    }
  }

  async function senare() {
    try {
      const r = await anropa<{ ok: true; vy: Vy }>('/api/senare', { method: 'POST', body: JSON.stringify({ fraga_id: fraga.id }) });
      // utkastet ligger kvar i sessionStorage tills fliken stängs, så text kunden skrivit inte kastas
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
        <button type="button" className="knapp sekundar" onClick={() => void skicka('ej_tillampligt')} disabled={lage === 'sparar' || !text.trim()}>Gäller inte oss (ange varför)</button>
        <button type="button" className="knapp sekundar" onClick={() => void skicka('atkomst_saknas')} disabled={lage === 'sparar' || !text.trim()}>Åtkomst saknas (beskriv)</button>
        <button type="button" className="knapp lank" onClick={() => void senare()} disabled={lage === 'sparar'}>Återkom senare</button>
      </div>
      <p className={'status ' + lage} role="status" aria-live="polite">{statusText}</p>
      {fel && (
        <p className="not fel" role="alert">
          {fel} <button type="button" className="knapp lank" onClick={() => void skicka(senasteTyp)}>Försök igen</button>
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
      <p>{vy.overlamning} Eventuella kompletteringsfrågor visas i det här samtalet när ni öppnar länken igen. Att material är mottaget betyder ännu inte att det är läst.</p>
      <p className="dis liten">Det här är en inlämning av underlag, inte ett godkännande av en design eller ett avtal om fler tjänster. Ni kan öppna länken igen och ändra eller lägga till; det ni ändrar efter inlämningen syns för oss.</p>
      <div className="rad">
        <button type="button" className="knapp sekundar" onClick={() => gaTill('bild')}>Se vår bild av er</button>
        <button type="button" className="knapp sekundar" onClick={() => gaTill('material')}>Lägg till material</button>
      </div>
    </div>
  );
}

function Tackningsbild({ vy }: { vy: Vy }) {
  const oppna = vy.tackning.filter(t => ['inte_undersokt', 'kunden_vet_inte', 'atkomst_saknas', 'aterkom_senare'].includes(t.status));
  const status: Record<string, string> = { inte_undersokt: 'ännu inte undersökt', kunden_vet_inte: 'ni vet inte ännu', atkomst_saknas: 'åtkomst saknas', aterkom_senare: 'ni vill återkomma' };
  return <details className="not"><summary>Vad som fortfarande behöver undersökas ({oppna.length})</summary><p>Ni kan lämna in redan nu. De här frågorna följer med som öppna frågor och blir inte automatiskt ”behövs inte”. Digitala väljer relevanta kompletteringar.</p><ul>{oppna.map(t => <li key={t.nyckel}>{t.fraga} — {status[t.status]}</li>)}</ul>{vy.behov.filter(b => b.status === 'oppen').map(b => <p key={b.nyckel}>Öppet behov från era ord: ”{b.citat}”</p>)}</details>;
}
