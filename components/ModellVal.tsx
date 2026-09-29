'use client';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ProvVy } from '@/lib/provlage';
import { Ikon } from './Ikon';

/**
 * Testlägets val av modell och ansträngning i skrivrutan, som i förbättringspartnern. Visas bara när servern kör det
 * lokala testläget (vy.ai.prov finns); kunder ser aldrig en modellväljare. Radioknapparna ger piltangenterna utan egen
 * tangenthantering: ↑↓ byter modell, ←→ byter ansträngning, Esc stänger och lämnar fokus på knappen.
 */
export default function ModellVal({ prov, oppen, setOppen, byt, status }: {
  prov: ProvVy;
  oppen: boolean;
  setOppen: (v: boolean) => void;
  byt: (modell: string, anstrangning: string) => void;
  status: string;
}) {
  const ram = useRef<HTMLDivElement | null>(null);
  const knapp = useRef<HTMLButtonElement | null>(null);
  const meny = useRef<HTMLDivElement | null>(null);
  const grupp = useId(); // egna radiogrupper per skrivruta, även när två frågor är öppna

  // Menyn öppnas uppåt när den ryms ovanför knappen, annars nedåt; mätt före utritningen.
  useLayoutEffect(() => {
    const m = meny.current;
    const r = ram.current?.getBoundingClientRect();
    if (!oppen || !m || !r) return;
    const ovan = r.top - 24;
    const nedan = window.innerHeight - r.bottom - 24;
    const upp = ovan >= m.offsetHeight || ovan > nedan;
    m.dataset.riktning = upp ? 'upp' : 'ner';
    // På bred skärm får menyn högst det utrymme som finns åt det hållet; på smal skärm är den ett ark (CSS).
    m.style.maxHeight = window.innerWidth >= 640 ? Math.max(160, upp ? ovan : nedan) + 'px' : '';
  }, [oppen]);

  useEffect(() => {
    if (!oppen) return;
    // Fokus in i menyn på den valda modellen; klick utanför stänger.
    ram.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    const utanfor = (e: MouseEvent) => {
      if (ram.current && !ram.current.contains(e.target as Node)) setOppen(false);
    };
    document.addEventListener('mousedown', utanfor);
    return () => document.removeEventListener('mousedown', utanfor);
  }, [oppen, setOppen]);

  return (
    <div className="modellval-ram" ref={ram}>
      <button type="button" ref={knapp} className="piller modellrad" aria-haspopup="dialog" aria-expanded={oppen}
        aria-label={`Modell och ansträngning: ${prov.namn}, ${prov.anstrangning}`} onClick={() => setOppen(!oppen)}>
        {prov.namn} · {prov.anstrangning}<Ikon namn="ner" storlek={16} />
      </button>
      {oppen && (
        <div className="modellmeny" ref={meny} role="dialog" aria-label="Modell och ansträngning i testläget"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOppen(false); knapp.current?.focus(); } }}>
          <fieldset className="mv-grupp">
            <legend>Modell</legend>
            {prov.modeller.map((m) => (
              <label key={m.id} className={'mv-modell' + (m.id === prov.modell ? ' vald' : '')}>
                <input type="radio" name={grupp + '-modell'} value={m.id} checked={m.id === prov.modell} onChange={() => byt(m.id, prov.anstrangning)} />
                <span className="mv-namn">{m.namn}</span>
                <span className="mv-om">{m.om}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="mv-grupp">
            <legend>Ansträngning</legend>
            <div className="mv-nivaer">
              {prov.nivaer.map((n) => (
                <label key={n} className={'mv-niva' + (n === prov.anstrangning ? ' vald' : '')}>
                  <input type="radio" name={grupp + '-niva'} value={n} checked={n === prov.anstrangning} onChange={() => byt(prov.modell, n)} />
                  <span>{n}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="mv-fot">Gäller från nästa fråga. Lokalt testläge på din Claude-inloggning. /model och /effort fungerar också i rutan.</p>
        </div>
      )}
      <span className="mv-status" role="status" aria-live="polite">{status}</span>
    </div>
  );
}
