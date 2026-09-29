'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnropsFel, anropa, klockslag, lasUtkast, medInnehall, nyNyckel, sparaUtkast } from '@/lib/klient';
import type { Svar } from '@/lib/typer';
import type { FragaVy, Vy } from '@/lib/vy';
import { Ikon, Marke } from './Ikon';
import { TillvalKort } from './Tillval';

type NastaSvar = { ok: true; klar: boolean; vantar: boolean; forkastad: boolean; meddelande: string; ai: { lage: string; anvand: boolean; fallback: boolean; fel?: string }; fragor: FragaVy[]; vy: Vy };
type SvarSvar = { ok: true; ny: boolean; sparat: string; vy: Vy };

/** Vad som ändrats i "Ditt uppdrag" mellan två lägen, i kundens ord. */
function andringar(fore: Vy, efter: Vy): string {
  const delar: string[] = [];
  const nyaRader = efter.bild.filter((r) => !fore.bild.some((x) => x.nyckel === r.nyckel && x.varde === r.varde));
  if (nyaRader.length) delar.push(nyaRader.length === 1 ? `${nyaRader[0].rubrik.toLowerCase()}` : `${nyaRader.length} uppgifter`);
  const nyaVal = efter.uppdrag.valda.filter((t) => !fore.uppdrag.valda.some((x) => x.id === t.id && x.kundval === t.kundval));
  for (const t of nyaVal) delar.push(`${t.namn}: ${t.kundval_text?.toLowerCase()}`);
  const nyaRek = efter.uppdrag.rekommenderade.filter((t) => !fore.uppdrag.rekommenderade.some((x) => x.id === t.id));
  for (const t of nyaRek) delar.push(`rekommendation: ${t.namn.toLowerCase()}`);
  const nyResearch = efter.uppdrag.research.length - fore.uppdrag.research.length;
  if (nyResearch > 0) delar.push(nyResearch === 1 ? 'en sak som Digitala undersöker' : `${nyResearch} saker som Digitala undersöker`);
  return delar.length ? delar.join(' · ') : '';
}

/** Hälsning efter kundens egen klocka; sätts först i webbläsaren så att serverns och klientens rendering stämmer. */
function useHalsning(): string {
  const [h, setH] = useState('Hej');
  useEffect(() => {
    const t = new Date().getHours();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setH(t >= 5 && t < 10 ? 'God morgon' : t >= 17 && t < 23 ? 'God kväll' : 'Hej');
  }, []);
  return h;
}

export default function Samtal({ vy, setVy, visaUppdrag }: { vy: Vy; setVy: (v: Vy) => void; visaUppdrag: (avsnitt?: string) => void }) {
  const halsning = useHalsning();
  const [hamtar, setHamtar] = useState(false);
  const [hamtFel, setHamtFel] = useState('');
  const [andring, setAndring] = useState('');
  const [inlamnar, setInlamnar] = useState(false);
  const [igen, setIgen] = useState(0);
  // Efter inlämning visas bekräftelsen tills kunden väljer att berätta mer; då visas samtalet igen, även om den
  // öppna frågan ställdes före inlämningen (ärendet räknas som inlämnat tills kunden faktiskt ändrar något).
  const [fortsatter, setFortsatter] = useState(false);
  const bekraftelse = Boolean(vy.arende.inlamnad) && !fortsatter;
  const hamtarRef = useRef(false);
  const omforsok = useRef(0);
  const vyRef = useRef(vy);
  const fragaRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { vyRef.current = vy; }, [vy]);

  const hamtaNasta = useCallback(async (fortsatt = false) => {
    if (hamtarRef.current) return;
    hamtarRef.current = true;
    setHamtar(true);
    setHamtFel('');
    const fore = vyRef.current;
    try {
      const r = await anropa<NastaSvar>('/api/nasta', { method: 'POST', body: JSON.stringify({ fortsatt }) });
      setVy(r.vy);
      setAndring(andringar(fore, r.vy));
      // Ett annat anrop pågick redan, eller kunden hann ändra något under väntan: försök igen, högst tre gånger.
      if ((r.vantar || r.forkastad) && omforsok.current < 3) {
        omforsok.current += 1;
        window.setTimeout(() => setIgen((x) => x + 1), 1500 * omforsok.current);
      } else {
        if ((r.vantar || r.forkastad) && r.vy.oppna.length === 0 && !r.vy.klar) setHamtFel('Nästa fråga dröjer.');
        omforsok.current = 0;
      }
    } catch (e) {
      setHamtFel((e as AnropsFel).message);
    } finally {
      hamtarRef.current = false;
      setHamtar(false);
    }
  }, [setVy]);

  useEffect(() => {
    if (vy.oppna.length === 0 && !vy.klar && !bekraftelse && !hamtarRef.current) void hamtaNasta();
  }, [vy.oppna.length, vy.klar, bekraftelse, hamtaNasta]);

  // Begränsat omförsök när ett annat anrop pågick eller kunden hann ändra något under väntan.
  useEffect(() => {
    if (igen > 0) void hamtaNasta();
  }, [igen, hamtaNasta]);

  // Ny fråga på plats: flytta fokus till rubriken (skärmläsare och tangentbord), men inte vid första renderingen och
  // inte i startläget, där sidan just öppnats och kunden ännu inte gjort något.
  const forstaFragaId = vy.oppna[0]?.id;
  const forstaRendering = useRef(true);
  const startlage = useRef(true);
  const utanSvar = vy.samtal.every((r) => !r.svar);
  // Körs före fokuseffekten nedan (effekter körs i den ordning de står).
  useEffect(() => { startlage.current = utanSvar; }, [utanSvar]);
  useEffect(() => {
    if (forstaRendering.current) {
      forstaRendering.current = false;
      return;
    }
    if (forstaFragaId && !startlage.current) fragaRef.current?.focus();
  }, [forstaFragaId]);

  async function lamnaIn() {
    setInlamnar(true);
    try {
      const r = await anropa<{ ok: true; vy: Vy }>('/api/inlamning', { method: 'POST' });
      setVy(r.vy);
      setFortsatter(false);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setHamtFel((e as AnropsFel).message);
    } finally {
      setInlamnar(false);
    }
  }

  const besvarade = vy.samtal.filter((r) => r.svar);
  const forsta = besvarade.length === 0 && !bekraftelse;
  const kanda = vy.bild.filter((b) => b.typ === 'forifylld');

  const fragor = !bekraftelse && vy.oppna.map((f, i) => (
    <FragaKort key={f.id} fraga={f} vy={vy} setVy={setVy} visaUppdrag={visaUppdrag} lage={forsta ? 'start' : i === 0 ? 'fast' : 'inline'}
      rubrikRef={i === 0 ? fragaRef : undefined} onSparat={(v) => { setVy(v); setAndring(''); }} />
  ));
  const vantar = hamtar && <p className="status vantar" role="status">AI-stödet läser det ni skrivit och formulerar nästa fråga …</p>;
  const hamtFelRad = hamtFel && (
    <p className="not fel" role="alert">
      {hamtFel} Det ni svarat är sparat. <button type="button" className="knapp lank inline" onClick={() => void hamtaNasta()}>Försök igen</button>
    </p>
  );

  if (!bekraftelse && forsta) {
    // Startläget: en hälsning, en fråga och en stor skrivruta i mitten, med genvägar under.
    return (
      <div className="samtal start">
        <div className="start-inre">
          <h1 className="halsning"><Marke /><span>{halsning}, {vy.arende.kund.namn}.</span></h1>
          {fragor}
          {vantar}
          {hamtFelRad}
          <div className="forslag" role="group" aria-label="Annat ni kan göra">
            <button type="button" className="piller" onClick={() => visaUppdrag('material')}><Ikon namn="material" />Lämna material</button>
            <button type="button" className="piller" onClick={() => visaUppdrag('tillval')}><Ikon namn="tillval" />Välj tillval</button>
            <button type="button" className="piller" onClick={() => visaUppdrag('mal')}><Ikon namn="mal" />Skriv målet själva</button>
          </div>
          <p className="intro">Här berättar ni om er verksamhet och vad webbplatsen ska hjälpa er med. Ett AI-stöd från Nortropic ställer följdfrågor utifrån det ni säger och samlar allt i <button type="button" className="knapp lank inline" onClick={() => visaUppdrag()}>Ditt uppdrag</button>, där ni kan rätta det som inte stämmer. Svara med egna ord, så kort eller långt ni vill. ”Vet inte” är ett bra svar. Allt sparas, så ni kan pausa och fortsätta senare, också på en annan enhet.</p>
          {kanda.length > 0 && (
            <div className="kant-lista" aria-label="Det här vet vi redan">
              <h2 className="liten-rubrik">Det här vet vi redan</h2>
              {kanda.slice(0, 5).map((b) => (
                <div className="kant" key={b.nyckel}>
                  <span className="rubrik">{b.rubrik}</span>
                  <span className="varde">{b.varde}</span>
                  <span className="kalla">Från {b.kalla}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="samtal">
      {bekraftelse && <Bekraftelse vy={vy} visaUppdrag={visaUppdrag} fortsatt={() => { setFortsatter(true); void hamtaNasta(true); }} />}

      {!bekraftelse && besvarade.length > 0 && (
        <ol className="logg" aria-label="Samtalet hittills">
          {besvarade.map((r) => (
            <li key={r.fraga_id} className="tur">
              <div className="agent">
                {r.inledning && <p className="inledning-text">{r.inledning}</p>}
                <p className="fraga">{r.fraga}</p>
              </div>
              <div className={'kund' + (r.svar!.typ === 'vet_inte' ? ' vet-inte' : '')}>
                <p className="svar">{r.svar!.text}</p>
                <span className="meta">Sparat {klockslag(r.svar!.tid)}{r.svar!.andrad > 0 ? ' · ändrat' : ''}</span>
              </div>
            </li>
          ))}
        </ol>
      )}

      {andring && !bekraftelse && (
        <p className="andring" role="status">
          Uppdaterat i Ditt uppdrag: {andring}. <button type="button" className="knapp lank inline" onClick={() => visaUppdrag()}>Visa</button>
        </p>
      )}

      {vantar}
      {hamtFelRad}

      {!bekraftelse && vy.klar && !hamtar && (
        <div className="aktuell avslut">
          <h2>Det räcker för nu</h2>
          {vy.avslut ? <p className="inledning-text">{vy.avslut}</p> : <p>Tack. Det ni berättat räcker för att vi ska kunna gå vidare.</p>}
          <p className="dis">Titta gärna igenom <button type="button" className="knapp lank inline" onClick={() => visaUppdrag()}>Ditt uppdrag</button>, välj tillval och lägg till material om ni har. Lämna sedan in, så hämtar Digitala underlaget.</p>
          <div className="rad">
            <button type="button" className="knapp" onClick={() => void lamnaIn()} disabled={inlamnar}>{inlamnar ? 'Lämnar in …' : 'Lämna in'}</button>
            <button type="button" className="knapp sekundar" onClick={() => void hamtaNasta(true)} disabled={hamtar}>Jag vill berätta mer</button>
          </div>
        </div>
      )}

      {fragor}

      {!bekraftelse && !vy.klar && besvarade.length > 0 && (
        <p className="aterstar">
          {vy.aterstar.viktiga > 0 ? `Viktiga områden som ingen har berört än: ${vy.aterstar.viktiga}.` : 'De viktigaste områdena är berörda.'}{' '}
          Ni kan <button type="button" className="knapp lank inline" onClick={() => void lamnaIn()} disabled={inlamnar}>lämna in det ni har hittills</button> när som helst.
        </p>
      )}
    </div>
  );
}

/**
 * En öppen fråga: frågan står i samtalet och skrivrutan under den. I samtalsläget ligger rutan fast längst ned
 * ('fast'), i startläget i mitten ('start'); en andra öppen fråga får sin ruta direkt under frågan ('inline').
 */
function FragaKort({ fraga, vy, setVy, visaUppdrag, lage: plats, rubrikRef, onSparat }: { fraga: FragaVy; vy: Vy; setVy: (v: Vy) => void; visaUppdrag: (avsnitt?: string) => void; lage: 'start' | 'fast' | 'inline'; rubrikRef?: React.MutableRefObject<HTMLHeadingElement | null>; onSparat: (v: Vy) => void }) {
  const router = useRouter();
  const nyckel = vy.arende.id + ':' + fraga.id;
  const [text, setText] = useState('');
  const [idempotens, setIdempotens] = useState('');
  const [val, setVal] = useState('');
  const [lage, setLage] = useState<'tom' | 'osparad' | 'sparar' | 'sparat' | 'fel'>('tom');
  const [fel, setFel] = useState('');
  const [senasteTyp, setSenasteTyp] = useState<Svar['typ']>('text');
  const [fler, setFler] = useState(false);

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
    const innehall = typ === 'val' && fraga.typ === 'val' ? val : text;
    if (typ !== 'vet_inte' && !(typ === 'val' && fraga.typ === 'tillval') && !innehall.trim()) return;
    // En nyckel per fråga och försök: samma nyckel vid återförsök, så ett återförsök eller dubbelklick aldrig ger två rader.
    const id = idempotens || nyNyckel();
    if (!idempotens) {
      setIdempotens(id);
      sparaUtkast(nyckel, { text, idempotens: id });
    }
    setLage('sparar');
    setFel('');
    try {
      const r = await anropa<SvarSvar>('/api/svar', { method: 'POST', body: JSON.stringify({ fraga_id: fraga.id, text: innehall, typ, idempotens: medInnehall(id, typ + '|' + innehall) }) });
      sparaUtkast(nyckel, null);
      setLage('sparat');
      onSparat(r.vy);
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
      onSparat(r.vy);
    } catch (e) {
      setLage('fel');
      setFel((e as AnropsFel).message);
    }
  }

  const statusText = lage === 'sparar' ? 'Sparar …' : lage === 'osparad' ? 'Inte skickat än' : lage === 'sparat' ? 'Sparat' : '';
  const tillval = fraga.typ === 'tillval' ? (fraga.tillval || []).map((id) => vy.tillval.find((t) => t.id === id)).filter(Boolean) : [];
  const sparar = lage === 'sparar';
  const primar = () => {
    if (fraga.typ === 'tillval') void skicka('val');
    else if (text.trim() || val) void skicka(fraga.typ === 'val' && val && !text.trim() ? 'val' : 'text');
  };

  // .aktuell ger ingen egen ruta (display: contents): frågan och skrivrutan hör ihop i dokumentet, men rutan kan ligga
  // fast längst ned i hela samtalet.
  return (
    <div className={'aktuell' + (plats === 'start' ? ' start-fraga' : '')}>
      <div className="fraga-del">
        {fraga.inledning && <p className="inledning-text">{fraga.inledning}</p>}
        <h2 className="fragetext" ref={rubrikRef} tabIndex={-1}>{fraga.text}</h2>
        {fraga.varfor && <p className="varfor">Varför vi frågar: {fraga.varfor.replace(/\.$/, '')}.</p>}
        {fraga.typ === 'val' && fraga.alternativ ? (
          <div className="alternativ" role="group" aria-label="Alternativ">
            {fraga.alternativ.map((a) => (
              <button type="button" key={a} aria-pressed={val === a} onClick={() => setVal(val === a ? '' : a)}>{a}</button>
            ))}
          </div>
        ) : null}
        {tillval.length > 0 && (
          <div className="tillval-i-fraga" role="group" aria-label="Tillval att ta ställning till">
            {tillval.map((t) => <TillvalKort key={t!.id} t={t!} setVy={setVy} kompakt />)}
          </div>
        )}
      </div>
      <div className={'komponera' + (plats === 'fast' ? ' fast' : '')}>
        <div className="ruta">
          <label className="sr" htmlFor={'svar-' + fraga.id}>Ert svar</label>
          <textarea id={'svar-' + fraga.id} className="svar-falt" rows={plats === 'start' ? 3 : 2} value={text} onChange={(e) => andra(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); primar(); } }}
            placeholder={fraga.typ === 'tillval' ? 'Något ni vill tillägga? (valfritt)' : fraga.typ === 'val' ? 'Eller skriv med egna ord' : 'Skriv med egna ord'} enterKeyHint="send" autoCapitalize="sentences" />
          <div className="ruta-rad">
            {fraga.typ === 'tillval' ? (
              <button type="button" className="knapp skicka text" onClick={() => void skicka('val')} disabled={sparar}>{sparar ? 'Sparar …' : 'Klart, fortsätt'}</button>
            ) : (
              <button type="button" className="knapp skicka" aria-label={sparar ? undefined : 'Skicka svar'} onClick={primar} disabled={sparar || (!text.trim() && !val)}>
                {sparar ? 'Sparar …' : <><span className="skicka-text" aria-hidden="true">Skicka</span><Ikon namn="upp" /></>}
              </button>
            )}
            <button type="button" className="ruta-ikon" aria-label="Lämna material" title="Lämna material" onClick={() => visaUppdrag('material')}><Ikon namn="plus" storlek={20} /></button>
            <button type="button" className="piller" onClick={() => void skicka('vet_inte')} disabled={sparar}>Vet inte</button>
            <button type="button" className="piller" aria-label="Fler sätt att svara" aria-expanded={fler} onClick={() => setFler(!fler)}>Fler sätt<Ikon namn="ner" storlek={16} /></button>
          </div>
        </div>
        {fler && (
          <div className="rad fler">
            <button type="button" className="knapp sekundar" onClick={() => void skicka('ej_tillampligt')} disabled={sparar || !text.trim()}>Gäller inte oss (skriv varför)</button>
            <button type="button" className="knapp sekundar" onClick={() => void skicka('atkomst_saknas')} disabled={sparar || !text.trim()}>Vi saknar åtkomst (beskriv)</button>
            <button type="button" className="knapp lank" onClick={() => void senare()} disabled={sparar}>Återkom senare</button>
          </div>
        )}
        <p className={'status ' + lage} role="status" aria-live="polite">{statusText}</p>
        {fel && (
          <p className="not fel" role="alert">
            Inte sparat: {fel} <button type="button" className="knapp lank inline" onClick={() => void skicka(senasteTyp)}>Försök igen</button>
          </p>
        )}
      </div>
    </div>
  );
}

function Bekraftelse({ vy, visaUppdrag, fortsatt }: { vy: Vy; visaUppdrag: (avsnitt?: string) => void; fortsatt: () => void }) {
  const i = vy.arende.inlamnad!;
  const valda = vy.uppdrag.valda;
  return (
    <div className="bekraftelse">
      <h1>Tack, {vy.arende.kund.namn}.</h1>
      <p>Det här lämnade ni {klockslag(i.tid)}:</p>
      <ul>
        <li>{i.svar} svar i samtalet</li>
        <li>{i.material} {i.material === 1 ? 'fil eller länk' : 'filer och länkar'}</li>
        <li>{valda.length ? `${valda.length} tillval: ${valda.map((t) => `${t.namn} (${(t.kundval_text || '').toLowerCase()})`).join(', ')}` : 'inga valda tillval'}</li>
        <li>{vy.bild.filter((b) => b.typ === 'ai').length} tolkningar från AI-stödet, som ni kan rätta</li>
      </ul>
      <h2 className="liten-rubrik">Vad som händer nu</h2>
      <p>{vy.overlamning} Kompletterande frågor visas här i samtalet när ni öppnar länken igen. Mottaget material är inte detsamma som läst.</p>
      <p className="dis liten">Det här är underlag till ert uppdrag, inte ett godkännande av en design, ett köp av tillval eller ett avtal om fler tjänster. Ni kan ändra och lägga till när som helst; ändringar efter inlämningen syns för Digitala.</p>
      <div className="rad">
        <button type="button" className="knapp sekundar" onClick={() => visaUppdrag()}>Se Ditt uppdrag</button>
        <button type="button" className="knapp sekundar" onClick={fortsatt}>Jag vill berätta mer</button>
      </div>
    </div>
  );
}
