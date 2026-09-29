'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { klockslag } from '@/lib/klient';
import type { Vy } from '@/lib/vy';
import { Ikon } from './Ikon';
import Samtal from './Samtal';
import Uppdrag from './Uppdrag';

const SIDA = '(min-width: 1024px)'; // sidopanel till vänster, som i en vanlig samtalstjänst
const BRED = '(min-width: 1280px)'; // Ditt uppdrag står dessutom bredvid samtalet

function useMedia(fraga: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(fraga);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(fraga).matches,
    () => false,
  );
}

/** Antal poster i "Ditt uppdrag" som kunden kan se: uppgifter, tillval och material. */
function antal(vy: Vy): number {
  return vy.bild.length + vy.uppdrag.valda.length + vy.material.length;
}

const OVERFORING: Record<Vy['overforing'], string> = {
  ej_inlamnat: 'Inte inlämnat än',
  vantar: 'Inlämnat',
  hamtat: 'Hämtat av Digitala',
  andrat_efter: 'Ändrat efter inlämningen',
};

export default function Kundstart({ start }: { start: Vy }) {
  const [vy, setVy] = useState<Vy>(start);
  const sida = useMedia(SIDA);
  const bred = useMedia(BRED);
  const ark = useRef<HTMLDialogElement | null>(null);
  const oppnare = useRef<HTMLElement | null>(null);
  const [arkOppet, setArkOppet] = useState(false);
  const [fokus, setFokus] = useState<string | null>(null);

  const visaUppdrag = useCallback((avsnitt?: string) => {
    setFokus(avsnitt || null);
    if (bred) {
      // Översikten står redan bredvid: flytta dit, och flytta fokus så att tangentbord och skärmläsare följer med.
      const el = document.getElementById(avsnitt ? 'avsnitt-' + avsnitt : 'uppdrag-rubrik');
      if (el) {
        el.scrollIntoView({ block: 'start' });
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: true });
      }
      return;
    }
    // Fokus går tillbaka till det som öppnade arket: sidhuvudets knapp, en genväg eller skrivrutans plus. Safari
    // fokuserar inte en knapp vid klick; då används sidhuvudets knapp eller frågan som reserv när arket stängs.
    const aktiv = document.activeElement;
    oppnare.current = aktiv instanceof HTMLElement && aktiv !== document.body ? aktiv : null;
    if (!ark.current?.open) ark.current?.showModal();
    setArkOppet(true);
  }, [bred]);

  const stangUppdrag = useCallback(() => {
    ark.current?.close();
  }, []);

  useEffect(() => {
    const d = ark.current;
    if (!d) return;
    const vidStang = () => {
      setArkOppet(false);
      const mal = oppnare.current?.isConnected ? oppnare.current
        : document.querySelector<HTMLElement>('.uppdrag-knapp') || document.querySelector<HTMLElement>('h2.fragetext');
      mal?.focus();
    };
    d.addEventListener('close', vidStang);
    return () => d.removeEventListener('close', vidStang);
  }, []);

  // Blir skärmen så bred att översikten får plats bredvid samtalet stängs arket.
  useEffect(() => {
    if (bred && ark.current?.open) ark.current.close();
  }, [bred]);

  useEffect(() => {
    if (!fokus || (!arkOppet && !bred)) return;
    const el = document.getElementById('avsnitt-' + fokus);
    el?.scrollIntoView({ block: 'start' });
  }, [fokus, arkOppet, bred]);

  const n = antal(vy);
  return (
    <div className={'app' + (sida ? ' med-sida' : '') + (bred ? ' med-uppdrag' : '')}>
      {sida && <a className="hoppa" href="#samtal">Till samtalet</a>}
      {sida && <Sidopanel vy={vy} antal={n} visaUppdrag={visaUppdrag} />}
      <div className="huvudyta">
        {!sida && (
          <header className="huvud">
            <span className="ord">Nortropic<small>Kundstart</small></span>
            <button type="button" className="knapp sekundar uppdrag-knapp" aria-haspopup="dialog" onClick={() => visaUppdrag()}>
              Ditt uppdrag{n ? <span className="antal" aria-label={`${n} poster`}>{n}</span> : null}
            </button>
            <span className="kund">{vy.arende.kund.namn}{vy.arende.testdialog ? ' · testdialog' : ''}</span>
          </header>
        )}
        <main className="samtal-yta" id="samtal">
          <Samtal vy={vy} setVy={setVy} visaUppdrag={visaUppdrag} />
        </main>
        <footer className="fot">
          <span role="status">{vy.ai.beskrivning}</span>
          <Link href="/om">Så behandlar vi uppgifterna</Link>
        </footer>
      </div>
      {bred && (
        <aside className="uppdrag-yta" aria-labelledby="uppdrag-rubrik">
          <Uppdrag vy={vy} setVy={setVy} />
        </aside>
      )}
      <dialog ref={ark} className={'ark' + (sida ? ' fran-sidan' : '')} aria-labelledby="uppdrag-rubrik" onClick={(e) => { if (e.target === ark.current) stangUppdrag(); }}>
        {!bred && arkOppet && (
          <div className="ark-inre">
            <div className="ark-topp">
              <button type="button" className="knapp lank" onClick={stangUppdrag} autoFocus>Tillbaka till samtalet</button>
            </div>
            <Uppdrag vy={vy} setVy={setVy} tillSamtalet={stangUppdrag} />
          </div>
        )}
      </dialog>
    </div>
  );
}

/** Sidopanelen: vems ärende det är, genvägar in i Ditt uppdrag och läget för sparat och inlämnat. */
function Sidopanel({ vy, antal: totalt, visaUppdrag }: { vy: Vy; antal: number; visaUppdrag: (avsnitt?: string) => void }) {
  const u = vy.uppdrag;
  const forstatt = u.forstatt.reduce((s, g) => s + g.rader.length, 0);
  const genvagar: { id: string; text: string; ikon: string; antal: number }[] = [
    { id: 'mal', text: 'Det ni vill uppnå', ikon: 'mal', antal: u.mal.length },
    { id: 'forstatt', text: 'Verksamheten', ikon: 'verksamhet', antal: forstatt },
    { id: 'tillval', text: 'Tillval', ikon: 'tillval', antal: u.valda.length },
    { id: 'material', text: 'Material', ikon: 'material', antal: vy.material.length },
    { id: 'aterstar', text: 'Det som återstår', ikon: 'aterstar', antal: u.aterstar.length + u.research.length + u.senare.length },
  ];
  return (
    <aside className="sidopanel" aria-label="Ert ärende">
      <div className="sp-topp">
        <span className="ord">Nortropic</span>
        <span className="sp-under">Kundstart</span>
      </div>
      <nav className="sp-nav" aria-label="Genvägar">
        <a className="sp-lank" href="#samtal" aria-current="location"><Ikon namn="samtal" /><span>Samtalet</span></a>
        <p className="sp-rubrik" id="sp-uppdrag">Ditt uppdrag</p>
        <ul aria-labelledby="sp-uppdrag">
          <li>
            <button type="button" className="sp-lank" onClick={() => visaUppdrag()}>
              <Ikon namn="oversikt" />
              <span>Hela översikten</span>
              {totalt > 0 && <span className="sp-antal">{totalt}<span className="sr"> {totalt === 1 ? 'post' : 'poster'}</span></span>}
            </button>
          </li>
          {genvagar.map((g) => (
            <li key={g.id}>
              <button type="button" className="sp-lank" onClick={() => visaUppdrag(g.id)}>
                <Ikon namn={g.ikon} />
                <span>{g.text}</span>
                {g.antal > 0 && <span className="sp-antal">{g.antal}<span className="sr"> {g.antal === 1 ? 'post' : 'poster'}</span></span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="sp-fot">
        <p className="sp-kund">
          <span className="sp-initial" aria-hidden="true">{(vy.arende.kund.namn.trim()[0] || '?').toUpperCase()}</span>
          <span className="sp-namn">{vy.arende.kund.namn}{vy.arende.testdialog ? <span className="sp-tagg">testdialog</span> : null}</span>
        </p>
        <p className="sp-lage">Senast sparat {klockslag(vy.arende.uppdaterad)} · {OVERFORING[vy.overforing]}</p>
      </div>
    </aside>
  );
}
