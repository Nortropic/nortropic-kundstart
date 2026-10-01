'use client';
import { useEffect, useRef, useState } from 'react';
import { AnropsFel, anropa, klockslag, nyNyckel } from '@/lib/klient';
import type { FragaVy, Vy } from '@/lib/vy';
import Uppdrag from './Uppdrag';

type GranskaSvar = { ok: true; utford: boolean; fallback: boolean; vantar: boolean; forkastad: boolean; fel?: string; vy: Vy };
type NastaSvar = { ok: true; vantar: boolean; forkastad: boolean; fragor: FragaVy[]; vy: Vy };

/**
 * Granskningen ("Finally, confirm your decision"): sammanfattningen, översikten med rättelser, hela intervjun ordagrant
 * och samtycket. Kryssrutan blir aktiv först när slutet av intervjun varit i bild (eller nåtts med knappen); servern
 * kräver dessutom exakt samtyckestext och rätt fas. Efter inlämningen visas samma sida med det inlämnade.
 */
export default function Granskning({ vy, setVy, efterInlamning }: { vy: Vy; setVy: (v: Vy) => void; efterInlamning?: () => void }) {
  const [transkriptLast, setTranskriptLast] = useState(false);
  const [bekraftat, setBekraftat] = useState(false);
  const [lamnar, setLamnar] = useState(false);
  const [uppdaterar, setUppdaterar] = useState(false);
  const [berattar, setBerattar] = useState(false);
  const [fel, setFel] = useState('');
  const [idempotens] = useState(() => nyNyckel());
  const slut = useRef<HTMLDivElement | null>(null);
  const efter = vy.fas === 'inlamnat';
  const modellfritt = vy.ai.lage === 'regelstyrd';
  const s = vy.syntes;

  useEffect(() => {
    const el = slut.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { const t = window.setTimeout(() => setTranskriptLast(true), 0); return () => window.clearTimeout(t); }
    const io = new IntersectionObserver((poster) => { if (poster.some((p) => p.isIntersecting)) setTranskriptLast(true); });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  function hoppa() {
    slut.current?.scrollIntoView({ block: 'center' });
    slut.current?.focus({ preventScroll: true });
    setTranskriptLast(true);
  }

  async function uppdatera() {
    setUppdaterar(true);
    setFel('');
    try {
      const r = await anropa<GranskaSvar>('/api/granska', { method: 'POST', body: JSON.stringify({ igen: true }) });
      setVy(r.vy);
      if (r.vantar || r.forkastad) setFel('Sammanfattningen dröjer. Försök igen om en stund.');
    } catch (e) {
      setFel((e as AnropsFel).message);
    } finally {
      setUppdaterar(false);
    }
  }

  async function lamnaIn() {
    setLamnar(true);
    setFel('');
    try {
      const r = await anropa<{ ok: true; vy: Vy }>('/api/inlamning', { method: 'POST', body: JSON.stringify({ idempotens, samtycke: { version: vy.samtycke.version, text: vy.samtycke.text, bekraftat: true, transkript_last: true } }) });
      setVy(r.vy);
      efterInlamning?.();
      window.scrollTo({ top: 0 });
    } catch (e) {
      setFel((e as AnropsFel).message);
    } finally {
      setLamnar(false);
    }
  }

  async function berattaMer() {
    setBerattar(true);
    setFel('');
    try {
      const r = await anropa<NastaSvar>('/api/nasta', { method: 'POST', body: JSON.stringify({ fortsatt: true }) });
      setVy(r.vy);
      if (r.vantar || r.forkastad) setFel('Nästa fråga dröjer. Försök igen om en stund.');
    } catch (e) {
      setFel((e as AnropsFel).message);
    } finally {
      setBerattar(false);
    }
  }

  const visaSamtycke = !efter || vy.overforing === 'andrat_efter';
  const friskrivning = 'Det här är underlag till ert uppdrag, inte ett godkännande av en design, ett köp av tillval eller ett avtal om fler tjänster.';

  return (
    <div className="granskning">
      <h1>{efter ? 'Det ni lämnat' : 'Läs igenom innan ni lämnar in'}</h1>
      <p>{efter ? vy.overlamning : 'Så här förstod vi det ni berättade. Rätta det som inte stämmer, lägg till material eller tillval om ni vill, och läs igenom hela intervjun längst ned.'}</p>

      <section className="syntes" aria-labelledby="rubrik-syntes">
        <h2 id="rubrik-syntes">Sammanfattning</h2>
        {s ? (
          <>
            {s.sammanfattning.split(/\n{2,}/).map((stycke, i) => <p key={i} className="syntes-text">{stycke}</p>)}
            {s.nyckelinsikt && <p className="syntes-insikt">{s.nyckelinsikt}</p>}
            <p className="syntes-kalla dis liten">{s.valjare === 'ai' ? 'Skriven av AI-stödet utifrån era egna ord; citaten är ordagranna.' : 'Sammanställd ur era svar, ordagrant.'} Skriven {klockslag(s.tid)}.</p>
            {!s.aktuell && !uppdaterar && (
              <p className="not varn syntes-inaktuell">Ni har ändrat något efter att sammanfattningen skrevs. <button type="button" className="knapp lank inline" onClick={() => void uppdatera()}>Uppdatera sammanfattningen</button></p>
            )}
          </>
        ) : (
          !uppdaterar && <p className="tom">Sammanfattningen kunde inte skrivas just nu. <button type="button" className="knapp lank inline" onClick={() => void uppdatera()}>Försök igen</button></p>
        )}
        {uppdaterar && <p className="status vantar" role="status">{modellfritt ? 'Sammanställer era svar …' : 'Intervjuaren sammanfattar det ni berättat …'}</p>}
        {s && s.oppet.length > 0 && (
          <>
            <h2>Det som återstår</h2>
            <ul className="aterstar-lista">
              {s.oppet.map((o) => <li key={o.nyckel}><span>{o.rubrik}</span>{o.varfor ? <span className="meta"> {o.varfor}</span> : null}</li>)}
            </ul>
          </>
        )}
      </section>

      <Uppdrag vy={vy} setVy={setVy} />

      <section className="transkript" aria-labelledby="rubrik-transkript">
        <h2 id="rubrik-transkript">Hela intervjun</h2>
        <p className="dis">Här är hela intervjun, ordagrant. Läs igenom den innan ni lämnar in. <button type="button" className="knapp lank inline" onClick={hoppa}>Hoppa till slutet av intervjun</button></p>
        <ol className="logg" aria-label="Hela intervjun">
          {vy.transkript.map((r) => (
            <li key={r.fraga_id} className="tur">
              <div className="agent">
                {r.inledning && <p className="inledning-text">{r.inledning}</p>}
                <p className="fraga">{r.fraga}</p>
              </div>
              {r.svar ? (
                <div className={'kund' + (r.svar.typ === 'vet_inte' ? ' vet-inte' : '')}>
                  <p className="svar">{r.svar.text}</p>
                  <span className="meta">Sparat {klockslag(r.svar.tid)}{r.svar.andrad > 0 ? ' · ändrat' : ''}</span>
                </div>
              ) : (
                <p className="dis liten">{r.roll === 'avslut' ? '(inget tillägg)' : r.status === 'senare' ? '(ni vill återkomma)' : '(inget svar)'}</p>
              )}
            </li>
          ))}
        </ol>
        <div className="transkript-slut" ref={slut} tabIndex={-1}>Slut på intervjun.</div>
      </section>

      <section className="samtycke" aria-labelledby="rubrik-samtycke">
        {visaSamtycke ? (
          <>
            <h2 id="rubrik-samtycke">Bekräfta till sist</h2>
            <p>När ni lämnar in får Nortropic Digitala hela intervjun ordagrant, sammanfattningen, era rättelser, tillval och material. Det används bara för ert uppdrag. Ni kan ändra och lägga till efteråt; ändringar syns för Digitala.</p>
            <label className="samtycke-ruta">
              <input type="checkbox" checked={bekraftat} disabled={!transkriptLast} aria-describedby="samtycke-hint" onChange={(e) => setBekraftat(e.target.checked)} />
              <span>{vy.samtycke.text}</span>
            </label>
            <p id="samtycke-hint" className="samtycke-hint dis liten">{transkriptLast ? '' : 'Rulla igenom hela intervjun ovan först.'}</p>
            <div className="rad">
              <button type="button" className="knapp" onClick={() => void lamnaIn()} disabled={!bekraftat || lamnar}>{lamnar ? 'Lämnar in …' : efter ? 'Lämna in ändringarna' : 'Lämna in'}</button>
              <button type="button" className="knapp sekundar" onClick={() => void berattaMer()} disabled={lamnar || berattar}>{berattar ? 'Öppnar samtalet …' : 'Jag vill berätta mer'}</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="rubrik-samtycke">Inlämnat</h2>
            <p>{vy.overlamning}</p>
            <div className="rad">
              <button type="button" className="knapp sekundar" onClick={() => void berattaMer()} disabled={berattar}>{berattar ? 'Öppnar samtalet …' : 'Jag vill berätta mer'}</button>
            </div>
          </>
        )}
        <p className="dis liten">{friskrivning}</p>
        {fel && <p className="not fel" role="alert">{fel}</p>}
      </section>
    </div>
  );
}
