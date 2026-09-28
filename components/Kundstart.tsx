'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Vy } from '@/lib/vy';
import Samtal from './Samtal';
import Uppdrag from './Uppdrag';

const BRED = '(min-width: 1024px)';

function useBredSkarm(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(BRED);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(BRED).matches,
    () => false,
  );
}

/** Antal poster i "Ditt uppdrag" som kunden kan se: uppgifter, tillval och material. */
function antal(vy: Vy): number {
  return vy.bild.length + vy.uppdrag.valda.length + vy.material.length;
}

export default function Kundstart({ start }: { start: Vy }) {
  const [vy, setVy] = useState<Vy>(start);
  const bred = useBredSkarm();
  const ark = useRef<HTMLDialogElement | null>(null);
  const oppnaKnapp = useRef<HTMLButtonElement | null>(null);
  const [arkOppet, setArkOppet] = useState(false);
  const [fokus, setFokus] = useState<string | null>(null);

  const visaUppdrag = useCallback((avsnitt?: string) => {
    setFokus(avsnitt || null);
    if (bred) {
      if (avsnitt) document.getElementById('avsnitt-' + avsnitt)?.scrollIntoView({ block: 'start' });
      return;
    }
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
      oppnaKnapp.current?.focus();
    };
    d.addEventListener('close', vidStang);
    return () => d.removeEventListener('close', vidStang);
  }, []);

  // Går skärmen över till bred layout medan arket är öppet stängs arket; översikten står då bredvid samtalet.
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
    <div className="app">
      <header className="huvud">
        <span className="ord">Nortropic<small>Digitala</small></span>
        <span className="kund">{vy.arende.kund.namn}{vy.arende.testdialog ? ' · testdialog' : ''}</span>
        {!bred && (
          <button ref={oppnaKnapp} type="button" className="knapp sekundar uppdrag-knapp" aria-haspopup="dialog" onClick={() => visaUppdrag()}>
            Ditt uppdrag{n ? <span className="antal" aria-label={`${n} poster`}>{n}</span> : null}
          </button>
        )}
      </header>
      <div className="yta">
        <main className="samtal-yta" id="samtal">
          <Samtal vy={vy} setVy={setVy} visaUppdrag={visaUppdrag} />
        </main>
        {bred && (
          <aside className="uppdrag-yta" aria-labelledby="uppdrag-rubrik">
            <Uppdrag vy={vy} setVy={setVy} />
          </aside>
        )}
      </div>
      <dialog ref={ark} className="ark" aria-labelledby="uppdrag-rubrik" onClick={(e) => { if (e.target === ark.current) stangUppdrag(); }}>
        {!bred && arkOppet && (
          <div className="ark-inre">
            <div className="ark-topp">
              <button type="button" className="knapp lank" onClick={stangUppdrag} autoFocus>Tillbaka till samtalet</button>
            </div>
            <Uppdrag vy={vy} setVy={setVy} tillSamtalet={stangUppdrag} />
          </div>
        )}
      </dialog>
      <footer className="fot">
        <span role="status">{vy.ai.beskrivning}</span>
        <Link href="/om">Så behandlar vi uppgifterna</Link>
      </footer>
    </div>
  );
}
