'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnropsFel, anropa, klockslag, medInnehall, nyNyckel } from '@/lib/klient';
import type { FragaVy, SamtalRad, Vy } from '@/lib/vy';
import Komponera from './Komponera';

type NastaSvar = { ok: true; klar: boolean; vantar: boolean; forkastad: boolean; meddelande: string; ai: { lage: string; anvand: boolean; fallback: boolean; fel?: string }; fragor: FragaVy[]; vy: Vy };
type AvslutaSvar = { ok: true; ny: boolean; vantar: boolean; vy: Vy };
type GranskaSvar = { ok: true; utford: boolean; fallback: boolean; vantar: boolean; forkastad: boolean; fel?: string; vy: Vy };

/**
 * Intervjun: en tråd (intervjuarens återkoppling och fråga i serif, kundens ord i en bubbla), den aktuella frågan och
 * skrivrutan. Inga paneler, inga val, inga kort. I avrundningen (fas avslut) står intervjuarens avslutsmeddelande och
 * avslutsfrågan i ett kort med "Gå vidare till sammanfattningen" och "Jag vill berätta mer".
 */
export default function Intervju({ vy, setVy }: { vy: Vy; setVy: (v: Vy) => void }) {
  const [hamtar, setHamtar] = useState(false);
  const [hamtFel, setHamtFel] = useState('');
  const [igen, setIgen] = useState(0);
  const [avslutar, setAvslutar] = useState<'' | 'fraga' | 'pagar'>('');
  const [gar, setGar] = useState(false);
  const [utkast, setUtkast] = useState('');
  const hamtarRef = useRef(false);
  const omforsok = useRef(0);
  const fragaRef = useRef<HTMLHeadingElement | null>(null);
  const avslut = vy.fas === 'avslut';
  const oppen = vy.oppna[0];
  const avslutsfraga = oppen?.roll === 'avslut' ? oppen : undefined;
  const modellfritt = vy.ai.lage === 'regelstyrd';

  const hamtaNasta = useCallback(async (fortsatt = false) => {
    if (hamtarRef.current) return;
    hamtarRef.current = true;
    setHamtar(true);
    setHamtFel('');
    try {
      const r = await anropa<NastaSvar>('/api/nasta', { method: 'POST', body: JSON.stringify({ fortsatt }) });
      setVy(r.vy);
      // Ett annat anrop pågick redan, eller kunden hann ändra något under väntan: försök igen, högst tre gånger.
      if ((r.vantar || r.forkastad) && omforsok.current < 3) {
        omforsok.current += 1;
        window.setTimeout(() => setIgen((x) => x + 1), 1500 * omforsok.current);
      } else {
        if ((r.vantar || r.forkastad) && r.vy.oppna.length === 0 && r.vy.fas === 'intervju') setHamtFel('Nästa fråga dröjer.');
        omforsok.current = 0;
      }
    } catch (e) {
      setHamtFel((e as AnropsFel).message);
    } finally {
      hamtarRef.current = false;
      setHamtar(false);
    }
  }, [setVy]);

  // Nästa fråga hämtas när ingen står öppen (och vid begränsade omförsök när ett annat anrop pågick eller kunden
  // hann ändra något under väntan). Anropet startas i en egen task så att effekten själv inte sätter tillstånd.
  useEffect(() => {
    if (!(vy.fas === 'intervju' && vy.oppna.length === 0) && igen === 0) return;
    const t = window.setTimeout(() => { if (!hamtarRef.current) void hamtaNasta(); }, 0);
    return () => window.clearTimeout(t);
  }, [vy.fas, vy.oppna.length, igen, hamtaNasta]);

  // Ny fråga på plats: flytta fokus till rubriken (skärmläsare och tangentbord), men inte vid första renderingen och
  // inte innan kunden gjort något.
  const forstaFragaId = vy.oppna[0]?.id;
  const forstaRendering = useRef(true);
  const startlage = useRef(true);
  const utanSvar = vy.samtal.every((r) => !r.svar);
  useEffect(() => { startlage.current = utanSvar; }, [utanSvar]);
  useEffect(() => {
    if (forstaRendering.current) {
      forstaRendering.current = false;
      return;
    }
    if (forstaFragaId && !startlage.current) fragaRef.current?.focus();
  }, [forstaFragaId]);

  async function avsluta() {
    setAvslutar('pagar');
    setHamtFel('');
    try {
      const r = await anropa<AvslutaSvar>('/api/avsluta', { method: 'POST', body: '{}' });
      setVy(r.vy);
      if (r.vantar) setHamtFel('Intervjuaren är upptagen just nu. Försök igen om en stund.');
    } catch (e) {
      setHamtFel((e as AnropsFel).message);
    } finally {
      setAvslutar('');
    }
  }

  /** Till sammanfattningen: ett osänt tillägg skickas först, sedan skrivs sammanfattningen (kan ta en stund). */
  async function gaVidare() {
    setGar(true);
    setHamtFel('');
    try {
      if (utkast.trim() && avslutsfraga) {
        await anropa('/api/svar', { method: 'POST', body: JSON.stringify({ fraga_id: avslutsfraga.id, text: utkast, typ: 'text', idempotens: medInnehall(nyNyckel(), 'text|' + utkast) }) });
        setUtkast('');
      }
      const r = await anropa<GranskaSvar>('/api/granska', { method: 'POST', body: '{}' });
      setVy(r.vy);
      if (r.vy.fas !== 'granskning') setHamtFel(r.vantar || r.forkastad ? 'Sammanfattningen dröjer. Försök igen om en stund.' : 'Sammanfattningen kunde inte skrivas just nu. Försök igen.');
      else window.scrollTo({ top: 0 });
    } catch (e) {
      setHamtFel((e as AnropsFel).message);
    } finally {
      setGar(false);
    }
  }

  const besvarade = vy.samtal.filter((r) => r.svar);
  const avslutBesvarat = vy.samtal.some((r) => r.roll === 'avslut' && r.svar);
  const tur = (r: SamtalRad) => (
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
  );

  return (
    <div className="samtal">
      {besvarade.length > 0 && <ol className="logg" aria-label="Samtalet hittills">{besvarade.map(tur)}</ol>}

      {hamtar && <p className="status vantar" role="status">{modellfritt ? 'Hämtar nästa fråga …' : 'Intervjuaren läser det ni skrivit och formulerar nästa fråga …'}</p>}
      {avslutar === 'pagar' && <p className="status vantar" role="status">{modellfritt ? 'Avslutar …' : 'Intervjuaren rundar av …'}</p>}
      {gar && <p className="status vantar" role="status">{modellfritt ? 'Sammanställer era svar …' : 'Intervjuaren sammanfattar det ni berättat …'}</p>}
      {hamtFel && (
        <p className="not fel" role="alert">
          {hamtFel} Det ni svarat är sparat. <button type="button" className="knapp lank inline" onClick={() => (avslut ? void gaVidare() : void hamtaNasta())}>Försök igen</button>
        </p>
      )}

      {avslut && (
        <div className="aktuell avslut">
          {vy.avslut && !avslutBesvarat && <p className="inledning-text">{vy.avslut}</p>}
          {avslutsfraga && (
            <>
              <h2 className="fragetext" ref={fragaRef} tabIndex={-1}>{avslutsfraga.text}</h2>
              <Komponera fraga={avslutsfraga} vy={vy} onSparat={setVy} fast={false} placeholder="Något ni vill tillägga? (valfritt)" onUtkast={setUtkast} />
            </>
          )}
          <div className="rad avslut-val">
            <button type="button" className="knapp" onClick={() => void gaVidare()} disabled={gar || hamtar}>{gar ? 'Sammanställer …' : utkast.trim() && avslutsfraga ? 'Skicka och gå vidare' : 'Gå vidare till sammanfattningen'}</button>
            <button type="button" className="knapp sekundar" onClick={() => void hamtaNasta(true)} disabled={hamtar || gar}>Jag vill berätta mer</button>
          </div>
        </div>
      )}

      {!avslut && oppen && (
        <div className="aktuell">
          <div className="fraga-del">
            {oppen.inledning && <p className="inledning-text">{oppen.inledning}</p>}
            <h2 className="fragetext" ref={fragaRef} tabIndex={-1}>{oppen.text}</h2>
            {oppen.varfor && <p className="varfor">Varför vi frågar: {oppen.varfor.replace(/\.$/, '')}.</p>}
            {vy.framsteg && <p className="framsteg">Fråga {vy.framsteg.nr} av ungefär {vy.framsteg.ungefar}</p>}
          </div>
          <Komponera fraga={oppen} vy={vy} onSparat={setVy} fast />
        </div>
      )}

      {!avslut && besvarade.length > 0 && avslutar !== 'pagar' && (
        <p className="avsluta">
          {avslutar !== 'fraga' ? (
            <>Vill ni avsluta här? <button type="button" className="knapp lank inline" onClick={() => setAvslutar('fraga')} disabled={hamtar}>Avsluta intervjun</button></>
          ) : (
            <span className="avsluta-bekrafta">
              Avsluta nu? Ni får sedan läsa igenom och bekräfta det ni berättat.{' '}
              <button type="button" className="knapp lank inline" onClick={() => void avsluta()}>Ja, avsluta</button>{' · '}
              <button type="button" className="knapp lank inline" onClick={() => setAvslutar('')}>Fortsätt intervjun</button>
            </span>
          )}
        </p>
      )}
    </div>
  );
}
