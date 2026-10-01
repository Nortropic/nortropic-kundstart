'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { Vy } from '@/lib/vy';
import Granskning from './Granskning';
import Intervju from './Intervju';
import Intro from './Intro';
import Tack from './Tack';

/**
 * Kundstart i intervjuformat: en fas i taget, i samma ordning som Anthropic Interviewer. Startskärm → intervjun (en
 * tråd, en skrivruta) → avrundning → granskning (sammanfattning, översikt, hela intervjun, samtycke) → tack. Fasen
 * ägs av servern (vy.fas); det enda lokala valet är om tacksidan eller det inlämnade visas efter inlämningen.
 */
export default function Kundstart({ start }: { start: Vy }) {
  const [vy, setVy] = useState<Vy>(start);
  const [visaLamnat, setVisaLamnat] = useState(false);
  const fas = vy.fas;
  let innehall: React.ReactNode;
  if (fas === 'intro') innehall = <Intro vy={vy} setVy={setVy} />;
  else if (fas === 'intervju' || fas === 'avslut') innehall = <Intervju vy={vy} setVy={setVy} />;
  else if (fas === 'granskning' || visaLamnat || vy.overforing === 'andrat_efter') innehall = <Granskning vy={vy} setVy={setVy} efterInlamning={() => setVisaLamnat(false)} />;
  else innehall = <Tack vy={vy} visaLamnat={() => setVisaLamnat(true)} />;
  return (
    <div className="app">
      <header className="huvud">
        <span className="ord">Nortropic<small>Kundstart</small></span>
        <span className="kund">{vy.arende.kund.namn}{vy.arende.testdialog ? ' · testdialog' : ''}</span>
      </header>
      <main className="samtal-yta" id="samtal">{innehall}</main>
      <footer className="fot">
        <span role="status">{vy.ai.beskrivning}</span>
        <Link href="/om">Så behandlar vi uppgifterna</Link>
      </footer>
    </div>
  );
}
