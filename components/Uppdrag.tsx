'use client';
import { useState } from 'react';
import { AnropsFel, anropa, klockslag, lasUtkast, nyNyckel, sparaUtkast } from '@/lib/klient';
import type { BildRad } from '@/lib/arende';
import type { Vy } from '@/lib/vy';
import Material from './Material';
import { AnnatBehov, TillvalKort } from './Tillval';

const STATUS: Record<string, string> = { inte_undersokt: 'ingen har berört det än', namnt: 'ni har nämnt det; detaljerna återstår', kunden_vet_inte: 'ni vet inte ännu', atkomst_saknas: 'åtkomst saknas', aterkom_senare: 'ni vill återkomma' };

/**
 * Ditt uppdrag: samma ärende som samtalet, som översikt. Varje uppgift kan rättas här; rättelsen sparas i samma ärende
 * och står över äldre tolkningar. Kundens val, Digitalas rekommendationer och Digitalas status hålls isär.
 */
export default function Uppdrag({ vy, setVy, tillSamtalet }: { vy: Vy; setVy: (v: Vy) => void; tillSamtalet?: () => void }) {
  const u = vy.uppdrag;
  const ovriga = vy.tillval.filter((t) => !t.kundval && !t.rekommendation);
  const avstatt = vy.tillval.filter((t) => t.kundval === 'inte_nu');
  return (
    <div className="uppdrag">
      <h1 id="uppdrag-rubrik">Ditt uppdrag</h1>
      <p className="uppdrag-status">Senast ändrat {klockslag(vy.arende.uppdaterad)}. {vy.overlamning}</p>

      <section id="avsnitt-mal" className="avsnitt" aria-labelledby="rubrik-mal">
        <h2 id="rubrik-mal">Det ni vill uppnå</h2>
        {u.mal.length ? u.mal.map((r) => <Rad key={r.nyckel} rad={r} setVy={setVy} />) : <p className="tom">Växer fram när ni berättar i samtalet.</p>}
        {!u.mal.some((r) => r.nyckel === 'verksamhetsmal') && <NyUppgift nyckel="verksamhetsmal" etikett="Skriv målet själva" setVy={setVy} />}
      </section>

      <section id="avsnitt-forstatt" className="avsnitt" aria-labelledby="rubrik-forstatt">
        <h2 id="rubrik-forstatt">Det vi har förstått om verksamheten</h2>
        {u.forstatt.length === 0 && <p className="tom">Inget ännu. Här samlas det ni berättar, med era egna ord skilda från AI-stödets tolkningar.</p>}
        {u.forstatt.map((g) => (
          <div key={g.omrade || 'ovrigt'} className="grupp">
            <h3 className="grupp-rubrik">{g.namn}</h3>
            {g.rader.map((r) => <Rad key={r.nyckel} rad={r} setVy={setVy} />)}
          </div>
        ))}
      </section>

      <section id="avsnitt-tillval" className="avsnitt" aria-labelledby="rubrik-tillval">
        <h2 id="rubrik-tillval">Tillval</h2>
        <p className="dis liten">Allt här är valfritt. Ett val är ett önskemål till Digitala, inte ett köp och inget tillstånd att ändra era konton.</p>
        <h3 className="grupp-rubrik">Valt av er</h3>
        {u.valda.length ? u.valda.map((t) => <TillvalKort key={t.id} t={t} setVy={setVy} />) : <p className="tom">Inga tillval valda ännu.</p>}
        {u.rekommenderade.length > 0 && (
          <>
            <h3 className="grupp-rubrik">Förslag från Digitala</h3>
            <p className="dis liten">Utifrån det ni berättat. Inget av detta är valt förrän ni själva väljer.</p>
            {u.rekommenderade.map((t) => <TillvalKort key={t.id} t={t} setVy={setVy} />)}
          </>
        )}
        <details className="alla-tillval">
          <summary>Alla möjligheter ({ovriga.length + avstatt.length})</summary>
          {vy.grupper.map((g) => {
            const iGrupp = [...ovriga, ...avstatt].filter((t) => t.grupp === g);
            if (!iGrupp.length) return null;
            return (
              <div key={g} className="grupp">
                <h3 className="grupp-rubrik">{g}</h3>
                {iGrupp.map((t) => <TillvalKort key={t.id} t={t} setVy={setVy} />)}
              </div>
            );
          })}
          <AnnatBehov setVy={setVy} />
        </details>
      </section>

      <section id="avsnitt-material" className="avsnitt" aria-labelledby="rubrik-material">
        <h2 id="rubrik-material">Material</h2>
        <Material vy={vy} setVy={setVy} />
      </section>

      <section id="avsnitt-aterstar" className="avsnitt" aria-labelledby="rubrik-aterstar">
        <h2 id="rubrik-aterstar">Det som återstår</h2>
        {u.aterstar.length === 0 && u.research.length === 0 && u.senare.length === 0 && <p className="tom">Inga viktiga frågor står öppna just nu.</p>}
        {u.aterstar.length > 0 && (
          <ul className="aterstar-lista">
            {u.aterstar.map((x) => <li key={x.nyckel}><span>{x.fraga}</span> <span className="meta">{STATUS[x.status] || x.status}{x.prio === 1 ? ' · viktigt' : ''}</span></li>)}
          </ul>
        )}
        {u.research.length > 0 && (
          <>
            <h3 className="grupp-rubrik">Digitala undersöker själva</h3>
            <p className="dis liten">Beställt i samtalet. Arbetet börjar när Digitala har hämtat ert underlag; det har inte påbörjats här.</p>
            <ul className="aterstar-lista">{u.research.map((r) => <li key={r.id}><span>{r.fraga}</span>{r.varfor ? <span className="meta"> {r.varfor}</span> : null}</li>)}</ul>
          </>
        )}
        {u.senare.length > 0 && <Senare vy={vy} setVy={setVy} tillSamtalet={tillSamtalet} />}
      </section>
    </div>
  );
}

function Senare({ vy, setVy, tillSamtalet }: { vy: Vy; setVy: (v: Vy) => void; tillSamtalet?: () => void }) {
  const [fel, setFel] = useState('');
  async function oppna(id: string) {
    try {
      const r = await anropa<{ ok: true; vy: Vy }>('/api/senare', { method: 'POST', body: JSON.stringify({ fraga_id: id, oppna: true }) });
      setVy(r.vy);
      setFel('');
      tillSamtalet?.();
    } catch (e) {
      setFel((e as AnropsFel).message);
    }
  }
  return (
    <>
      <h3 className="grupp-rubrik">Frågor ni kan ta upp igen</h3>
      <ul className="aterstar-lista">
        {vy.uppdrag.senare.map((s) => <li key={s.id}><span>{s.text}</span>{s.not ? <span className="meta"> {s.not}</span> : null} <button type="button" className="knapp lank inline" onClick={() => void oppna(s.id)}>Svara nu</button></li>)}
      </ul>
      {fel && <p className="not fel" role="alert">{fel}</p>}
    </>
  );
}

function ursprung(rad: BildRad): string {
  if (rad.typ === 'kund') return rad.kalla === 'kundens rättelse' ? `Er rättelse ${klockslag(rad.tid)}` : `Era ord ${klockslag(rad.tid)}`;
  if (rad.typ === 'ai') return 'AI-stödets tolkning av det ni sagt. Rätta gärna.';
  return `Från ${rad.kalla}. Rätta gärna om det inte stämmer.`;
}

function Rad({ rad, setVy }: { rad: BildRad; setVy: (v: Vy) => void }) {
  const utkastNyckel = 'rattelse:' + rad.nyckel;
  const [oppen, setOppen] = useState(false);
  const [text, setText] = useState(rad.varde);
  const [idempotens, setIdempotens] = useState('');
  const [lage, setLage] = useState<'' | 'sparar' | 'fel' | 'ingen'>('');
  const [fel, setFel] = useState('');
  function oppna() {
    const u = lasUtkast(utkastNyckel);
    setText(u?.text || rad.varde);
    setIdempotens(u?.idempotens || nyNyckel()); // ny nyckel per öppnat fält: varje rättelse är en egen handling
    setLage('');
    setOppen(true);
  }
  function andra(t: string) {
    setText(t);
    sparaUtkast(utkastNyckel, { text: t, idempotens });
  }
  async function spara() {
    setLage('sparar');
    setFel('');
    try {
      const r = await anropa<{ ok: true; ny: boolean; vy: Vy }>('/api/rattelse', { method: 'POST', body: JSON.stringify({ nyckel: rad.nyckel, varde: text, idempotens }) });
      setVy(r.vy);
      if (!r.ny) {
        setLage('ingen'); // servern sparade ingen ändring (samma värde som förut): fältet står kvar
        return;
      }
      sparaUtkast(utkastNyckel, null);
      setOppen(false);
      setLage('');
    } catch (e) {
      setLage('fel');
      setFel((e as AnropsFel).message);
    }
  }
  return (
    <div className={'bild-rad' + (rad.typ === 'ai' ? ' ai' : '')}>
      <span className="rubrik">{rad.rubrik}</span>
      <p className="varde">{rad.varde}</p>
      <span className={'ursprung' + (rad.typ === 'ai' ? ' ai' : '')}>{ursprung(rad)}</span>
      {!oppen ? (
        <div className="rattning">
          <button type="button" className="knapp lank" onClick={oppna} aria-label={`Ändra ${rad.rubrik}`}>Ändra</button>
        </div>
      ) : (
        <div className="rattning">
          <label className="sr" htmlFor={'ratt-' + rad.nyckel}>Rätta {rad.rubrik}</label>
          <textarea id={'ratt-' + rad.nyckel} className="ratt-falt" value={text} onChange={(e) => andra(e.target.value)} />
          <div className="rad">
            <button type="button" className="knapp" onClick={() => void spara()} disabled={lage === 'sparar' || !text.trim() || text.trim() === rad.varde}>{lage === 'sparar' ? 'Sparar …' : 'Spara rättelse'}</button>
            <button type="button" className="knapp lank" onClick={() => setOppen(false)}>Avbryt</button>
          </div>
          {lage === 'ingen' && <p className="status osparad" role="status">Ingen ändring sparades: värdet var redan det som står ovan.</p>}
          {fel && <p className="not fel" role="alert">{fel}</p>}
        </div>
      )}
    </div>
  );
}

/** Kunden skriver en uppgift direkt i översikten (t.ex. målet) utan att vänta på en fråga. */
function NyUppgift({ nyckel, etikett, setVy }: { nyckel: string; etikett: string; setVy: (v: Vy) => void }) {
  const [oppen, setOppen] = useState(false);
  const [text, setText] = useState('');
  const [idempotens] = useState(() => nyNyckel());
  const [fel, setFel] = useState('');
  const [sparar, setSparar] = useState(false);
  async function spara(e: React.FormEvent) {
    e.preventDefault();
    setSparar(true);
    setFel('');
    try {
      const r = await anropa<{ ok: true; ny: boolean; vy: Vy }>('/api/rattelse', { method: 'POST', body: JSON.stringify({ nyckel, varde: text, idempotens }) });
      setVy(r.vy);
      setOppen(false);
    } catch (err) {
      setFel((err as AnropsFel).message);
    } finally {
      setSparar(false);
    }
  }
  if (!oppen) return <button type="button" className="knapp lank" onClick={() => setOppen(true)}>{etikett}</button>;
  return (
    <form onSubmit={(e) => void spara(e)} className="ny-uppgift">
      <label htmlFor={'ny-' + nyckel} className="liten">Vad vill ni att webbplatsen ska åstadkomma?</label>
      <textarea id={'ny-' + nyckel} className="ratt-falt" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="rad">
        <button type="submit" className="knapp" disabled={sparar || !text.trim()}>{sparar ? 'Sparar …' : 'Spara'}</button>
        <button type="button" className="knapp lank" onClick={() => setOppen(false)}>Avbryt</button>
      </div>
      {fel && <p className="not fel" role="alert">{fel}</p>}
    </form>
  );
}
