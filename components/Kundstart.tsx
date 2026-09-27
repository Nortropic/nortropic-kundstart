'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { Vy } from '@/lib/vy';
import Samtal from './Samtal';
import Bild from './Bild';
import Material from './Material';

type Flik = 'samtal' | 'bild' | 'material';

export default function Kundstart({ start }: { start: Vy }) {
  const [vy, setVy] = useState<Vy>(start);
  const [flik, setFlik] = useState<Flik>('samtal');
  const flikar: { id: Flik; namn: string; antal?: number }[] = [
    { id: 'samtal', namn: 'Samtal', antal: vy.oppna.length || undefined },
    { id: 'bild', namn: 'Vår bild av er', antal: vy.bild.length || undefined },
    { id: 'material', namn: 'Material', antal: vy.material.length || undefined },
  ];
  const ai = vy.ai.beskrivning;
  return (
    <main className="ram">
      <header className="huvud">
        <span className="ord">Nortropic<small>Digitala</small></span>
        <span className="kund">{vy.arende.kund.namn}{vy.arende.testdialog ? ' (testdialog)' : ''}</span>
      </header>
      <nav className="flikar" role="tablist" aria-label="Delar av samtalet">
        {flikar.map((f) => (
          <button key={f.id} role="tab" id={'flik-' + f.id} aria-selected={flik === f.id} aria-controls={'panel-' + f.id} className="flik" onClick={() => setFlik(f.id)}>
            {f.namn}
            {f.antal ? <span className="antal">{f.antal}</span> : null}
          </button>
        ))}
      </nav>
      <section role="tabpanel" id="panel-samtal" aria-labelledby="flik-samtal" hidden={flik !== 'samtal'}>
        <Samtal vy={vy} setVy={setVy} gaTill={setFlik} />
      </section>
      <section role="tabpanel" id="panel-bild" aria-labelledby="flik-bild" hidden={flik !== 'bild'}>
        <Bild vy={vy} setVy={setVy} />
      </section>
      <section role="tabpanel" id="panel-material" aria-labelledby="flik-material" hidden={flik !== 'material'}>
        <Material vy={vy} setVy={setVy} />
      </section>
      <footer className="fot">
        <span>{ai}</span>
        <Link href="/om">Så behandlar vi uppgifterna</Link>
      </footer>
    </main>
  );
}
