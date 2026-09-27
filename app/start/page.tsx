'use client';
// Länken bär sin nyckel i fragmentet (#...), som aldrig skickas till servern i URL:en och därför inte hamnar i
// serverloggar eller Referer. Sidan skickar nyckeln i en POST och byter den mot en signerad kaka.
import { useEffect, useState } from 'react';

export default function Start() {
  const [lage, setLage] = useState<'kollar' | 'saknas' | 'fel'>('kollar');
  const [meddelande, setMeddelande] = useState('');
  useEffect(() => {
    const token = (window.location.hash || '').replace(/^#/, '').trim();
    if (!token) {
      setLage('saknas');
      return;
    }
    history.replaceState(null, '', '/start');
    fetch('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), credentials: 'same-origin' })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { skal?: string; meddelande?: string };
        if (r.ok) {
          window.location.replace('/samtal');
          return;
        }
        window.location.replace('/lank?skal=' + encodeURIComponent(d.skal || 'ogiltig'));
      })
      .catch(() => {
        setLage('fel');
        setMeddelande('Ingen kontakt med servern. Ladda om sidan när ni har nät igen.');
      });
  }, []);
  return (
    <main className="ram">
      <header className="huvud">
        <span className="ord">Nortropic<small>Digitala</small></span>
      </header>
      {lage === 'kollar' && <p role="status">Öppnar ert samtal …</p>}
      {lage === 'saknas' && (
        <>
          <h1>Länken saknar sin nyckel</h1>
          <p>Öppna hela länken ni fick från er kontakt, inklusive delen efter tecknet #. Om ni klistrade in den för hand kan slutet ha fallit bort.</p>
        </>
      )}
      {lage === 'fel' && <p className="not fel" role="alert">{meddelande}</p>}
      <noscript>
        <p>Den här sidan behöver JavaScript för att öppna er personliga länk.</p>
      </noscript>
    </main>
  );
}
