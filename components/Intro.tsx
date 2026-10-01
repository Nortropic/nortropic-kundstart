'use client';
import { useState } from 'react';
import { AnropsFel, anropa } from '@/lib/klient';
import type { Vy } from '@/lib/vy';
import { Ikon, Marke } from './Ikon';

/** Startskärmen: vad intervjun är, hur lång den är och vad som händer efteråt. "Inte nu" sparar ingenting. */
export default function Intro({ vy, setVy }: { vy: Vy; setVy: (v: Vy) => void }) {
  const [borjar, setBorjar] = useState(false);
  const [inteNu, setInteNu] = useState(false);
  const [fel, setFel] = useState('');
  const modellfritt = vy.ai.lage === 'regelstyrd';

  async function borja() {
    setBorjar(true);
    setFel('');
    try {
      const r = await anropa<{ ok: true; vy: Vy }>('/api/borja', { method: 'POST', body: '{}' });
      setVy(r.vy);
    } catch (e) {
      setFel((e as AnropsFel).message);
    } finally {
      setBorjar(false);
    }
  }

  return (
    <div className="intro">
      <Marke storlek={36} />
      <h1>Berätta om er verksamhet, så bygger vi rätt webbplats</h1>
      <p>{vy.arende.kund.namn}, det här är en kort intervju om er verksamhet och vad webbplatsen ska hjälpa er med. Ni svarar med egna ord, så kort eller långt ni vill. Det ni berättar blir underlaget för Nortropic Digitalas arbete, så att ni slipper förklara samma sak igen.</p>
      <div className="intro-kort">
        <div className="intro-rad"><Ikon namn="klocka" storlek={22} /><p>Räkna med ungefär 15 minuter. Ni kan pausa och fortsätta senare, också på en annan enhet.</p></div>
        <div className="intro-rad"><Ikon namn="hand" storlek={22} /><p>Efteråt läser ni igenom intervjun och vår sammanfattning och bestämmer själva om den ska lämnas vidare.</p></div>
      </div>
      <p className="dis liten intro-lage">{modellfritt ? 'Frågorna följer Nortropics standardlista. Inget AI-stöd används, och det ni skriver skickas inte till någon språkmodell.' : 'Intervjun förs av ett AI-stöd från Nortropic. Era egna ord sparas ordagrant och skilt från AI:ns tolkningar.'}</p>
      <div className="intro-knappar">
        <button type="button" className="knapp" onClick={() => void borja()} disabled={borjar}>{borjar ? 'Öppnar …' : 'Börja intervjun'}</button>
        <button type="button" className="knapp sekundar" onClick={() => setInteNu(true)}>Inte nu</button>
      </div>
      {inteNu && <p className="not info" role="status">Det är lugnt. Ingenting har sparats än, och länken fungerar när ni vill börja.</p>}
      {fel && <p className="not fel" role="alert">{fel} <button type="button" className="knapp lank inline" onClick={() => void borja()}>Försök igen</button></p>}
    </div>
  );
}
