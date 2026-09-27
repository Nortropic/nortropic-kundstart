'use client';
import { useRef, useState } from 'react';
import { AnropsFel, anpassaBild, anropa, klockslag, nyNyckel, storlek } from '@/lib/klient';
import type { Vy } from '@/lib/vy';

const ACCEPT = '.jpg,.jpeg,.png,.webp,.svg,.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv';
const MAX = 4_000_000;

export default function Material({ vy, setVy }: { vy: Vy; setVy: (v: Vy) => void }) {
  const [lage, setLage] = useState<'' | 'laddar' | 'fel'>('');
  const [fel, setFel] = useState('');
  const [beskrivning, setBeskrivning] = useState('');
  const [url, setUrl] = useState('');
  const [urlBeskrivning, setUrlBeskrivning] = useState('');
  const [status, setStatus] = useState('');
  const filRef = useRef<HTMLInputElement | null>(null);

  async function laddaUpp(e: React.ChangeEvent<HTMLInputElement>) {
    const filer = Array.from(e.target.files || []);
    if (!filer.length) return;
    setLage('laddar');
    setFel('');
    let antal = 0;
    for (const original of filer) {
      const fil = await anpassaBild(original, MAX);
      if (fil.size > MAX) {
        setFel(`${original.name} är större än 4 MB. Förminska den eller dela upp den.`);
        continue;
      }
      const form = new FormData();
      form.append('fil', fil, fil.name);
      form.append('beskrivning', beskrivning);
      form.append('idempotens', nyNyckel());
      setStatus(`Laddar upp ${fil.name} …`);
      try {
        const r = await anropa<{ ok: true; ny: boolean; vy: Vy }>('/api/material', { method: 'POST', body: form });
        setVy(r.vy);
        if (r.ny) antal += 1;
        else setStatus(`${fil.name} fanns redan (samma innehåll); ingen kopia lades till.`);
      } catch (err) {
        setFel((err as AnropsFel).message);
      }
    }
    if (antal) setStatus(`${antal} ${antal === 1 ? 'fil mottagen' : 'filer mottagna'} och sparad${antal === 1 ? '' : 'e'} hos oss.`);
    setLage(fel ? 'fel' : '');
    setBeskrivning('');
    if (filRef.current) filRef.current.value = '';
  }

  async function laggLank(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLage('laddar');
    setFel('');
    try {
      const r = await anropa<{ ok: true; vy: Vy }>('/api/material', { method: 'POST', body: JSON.stringify({ url: url.trim(), beskrivning: urlBeskrivning, idempotens: nyNyckel() }) });
      setVy(r.vy);
      setUrl('');
      setUrlBeskrivning('');
      setStatus('Länken är sparad hos oss.');
      setLage('');
    } catch (err) {
      setLage('fel');
      setFel((err as AnropsFel).message);
    }
  }

  return (
    <div>
      <h1>Material</h1>
      <p>Har ni logotyp, bilder, texter, prislistor, omdömen eller en befintlig webbplats? Lämna det här, så slipper ni beskriva det. En mottagen fil betyder att den är sparad hos oss; vi läser den i nästa steg.</p>
      {vy.material.length > 0 && (
        <ul className="material-lista" aria-label="Lämnat material">
          {vy.material.map((m) => (
            <Post key={m.id} m={m} setVy={setVy} />
          ))}
        </ul>
      )}
      <h3>Ladda upp filer</h3>
      <label className="fil-val">
        <span className="liten dis">Bilder (jpg, png, webp, svg), PDF, Word, Excel, PowerPoint eller text. Högst 4 MB per fil; stora bilder förminskas i webbläsaren.</span>
        <input ref={filRef} type="file" accept={ACCEPT} multiple onChange={(e) => void laddaUpp(e)} disabled={lage === 'laddar'} aria-describedby="material-status" />
      </label>
      <label className="liten dis" htmlFor="beskrivning">Vad är det? (valfritt)</label>
      <input id="beskrivning" className="falt" value={beskrivning} onChange={(e) => setBeskrivning(e.target.value)} placeholder="T.ex. logotyp, prislista 2026, bilder från jobb" maxLength={300} />

      <h3>Eller lämna en länk</h3>
      <form onSubmit={(e) => void laggLank(e)}>
        <label className="liten dis" htmlFor="url">Webbadress</label>
        <input id="url" className="falt" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        <label className="liten dis" htmlFor="url-beskrivning" style={{ marginTop: '0.5rem', display: 'block' }}>Vad finns där? (valfritt)</label>
        <input id="url-beskrivning" className="falt" value={urlBeskrivning} onChange={(e) => setUrlBeskrivning(e.target.value)} placeholder="T.ex. vår nuvarande hemsida, Instagram, Google-profil" maxLength={300} />
        <div className="rad">
          <button type="submit" className="knapp sekundar" disabled={lage === 'laddar' || !url.trim()}>Spara länk</button>
        </div>
      </form>
      <p id="material-status" className="status" role="status" aria-live="polite">{lage === 'laddar' ? status || 'Laddar upp …' : status}</p>
      {fel && <p className="not fel" role="alert">{fel}</p>}
    </div>
  );
}

function Post({ m, setVy }: { m: Vy['material'][number]; setVy: (v: Vy) => void }) {
  const [bekrafta, setBekrafta] = useState(false);
  const [tarBort, setTarBort] = useState(false);
  async function taBort() {
    setTarBort(true);
    try {
      const r = await anropa<{ ok: true; vy: Vy }>('/api/material/' + m.id, { method: 'DELETE' });
      setVy(r.vy);
    } finally {
      setTarBort(false);
    }
  }
  return (
    <li>
      <span className="namn">
        {m.typ === 'fil' ? <a href={'/api/material/' + m.id}>{m.filnamn}</a> : <a href={m.url} rel="noreferrer noopener" target="_blank">{m.url}</a>}
        {m.beskrivning ? <span className="dis"> – {m.beskrivning}</span> : null}
      </span>
      <span className="meta">{m.typ === 'fil' ? storlek(m.storlek) + ' · ' : ''}mottagen {klockslag(m.mottaget)}</span>
      {!bekrafta ? (
        <button type="button" className="knapp lank" onClick={() => setBekrafta(true)}>Ta bort</button>
      ) : (
        <span>
          <button type="button" className="knapp lank" onClick={() => void taBort()} disabled={tarBort}>{tarBort ? 'Tar bort …' : 'Ja, ta bort'}</button>
          <button type="button" className="knapp lank" onClick={() => setBekrafta(false)}>Behåll</button>
        </span>
      )}
    </li>
  );
}
