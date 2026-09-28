'use client';
import { useState } from 'react';
import { AnropsFel, anropa, klockslag, nyNyckel } from '@/lib/klient';
import type { TillvalKundval } from '@/lib/typer';
import type { TillvalVy, Vy } from '@/lib/vy';

type Svar = { ok: true; ny: boolean; vy: Vy };

/**
 * Ett tillval med kundens fyra val. Kundens val, Digitalas rekommendation och Digitalas status hålls isär i text och
 * färg. Domänen har ett eget flöde: skriv domänen, så läser servern dess öppna uppgifter och sparar valet i samma steg.
 */
export function TillvalKort({ t, setVy, kompakt = false }: { t: TillvalVy; setVy: (v: Vy) => void; kompakt?: boolean }) {
  const [lage, setLage] = useState<'' | 'sparar' | 'sparat' | 'fel'>('');
  const [fel, setFel] = useState('');
  const [andrar, setAndrar] = useState(false);
  const [falt, setFalt] = useState<null | 'system' | 'har_system' | 'onskat'>(null);
  const [text, setText] = useState(t.system || '');
  const doman = t.id === 'doman';
  const idBas = 'tv-' + t.id;

  async function spara(url: string, kropp: Record<string, unknown>) {
    setLage('sparar');
    setFel('');
    try {
      const r = await anropa<Svar>(url, { method: 'POST', body: JSON.stringify({ ...kropp, idempotens: nyNyckel() }) });
      setVy(r.vy);
      setLage('sparat');
      setFalt(null);
      setAndrar(false);
    } catch (e) {
      setLage('fel');
      setFel((e as AnropsFel).message);
    }
  }
  const valj = (kundval: TillvalKundval | null, system?: string) => spara('/api/tillval', { tillval: t.id, kundval, system });
  const sparaDoman = (kundval: 'har_system' | 'onskat') => spara('/api/doman', { doman: text, kundval });

  const visaKnappar = !t.kundval || andrar;
  const chip = t.kundval ? <span className="chip val">{t.kundval_text}</span> : t.rekommendation ? <span className="chip rek">Rekommenderat</span> : null;

  return (
    <div className={'tillval-kort' + (kompakt ? ' kompakt' : '') + (t.kundval && t.kundval !== 'inte_nu' ? ' valt' : '')}>
      <div className="tv-huvud">
        <h3 className="tv-namn" id={idBas + '-namn'}>{t.namn}</h3>
        {chip}
        {t.digitala_status && <span className="chip digitala">{t.digitala_status}</span>}
      </div>
      {!kompakt && t.kort && <p className="tv-kort">{t.kort}</p>}
      {t.rekommendation && <p className="tv-rek"><span className="etikett">Digitalas förslag, inte ert val:</span> {t.rekommendation}</p>}
      {t.kundval && (
        <p className="tv-val">
          {t.kundval_text}{t.system ? `: ${t.system}` : ''}
          {t.kalla === 'samtal' && t.citat ? <span className="kalla"> · från samtalet: ”{t.citat}”</span> : null}
        </p>
      )}
      {t.kontroll && (
        <div className="tv-kontroll">
          <p>{t.kontroll.text}</p>
          {t.kontroll.anmarkningar.length > 0 && <ul>{t.kontroll.anmarkningar.map((a) => <li key={a}>{a}</li>)}</ul>}
          <p className="meta">Kontrollerat {klockslag(t.kontroll.tid)} i öppna uppgifter om domänen. Ingenting har ändrats hos er leverantör.</p>
        </div>
      )}
      {visaKnappar ? (
        <div className="rad tv-knappar" role="group" aria-labelledby={idBas + '-namn'}>
          {doman ? (
            <>
              <button type="button" className="knapp sekundar" aria-pressed={falt === 'har_system'} onClick={() => setFalt('har_system')} disabled={lage === 'sparar'}>Vi har redan en domän</button>
              <button type="button" className="knapp sekundar" aria-pressed={falt === 'onskat'} onClick={() => setFalt('onskat')} disabled={lage === 'sparar'}>Vi vill ha en ny</button>
            </>
          ) : (
            <>
              <button type="button" className="knapp sekundar" aria-pressed={t.kundval === 'onskat'} onClick={() => void valj('onskat')} disabled={lage === 'sparar'}>Lägg till</button>
              <button type="button" className="knapp sekundar" aria-pressed={falt === 'system' || t.kundval === 'har_system'} onClick={() => setFalt('system')} disabled={lage === 'sparar'}>Vi har redan ett system</button>
            </>
          )}
          <button type="button" className="knapp sekundar" aria-pressed={t.kundval === 'hjalp'} onClick={() => void valj('hjalp')} disabled={lage === 'sparar'}>{doman ? 'Hjälp oss välja' : 'Hjälp mig välja'}</button>
          <button type="button" className="knapp lank" aria-pressed={t.kundval === 'inte_nu'} onClick={() => void valj('inte_nu')} disabled={lage === 'sparar'}>Inte nu</button>
          {andrar && <button type="button" className="knapp lank" onClick={() => { setAndrar(false); setFalt(null); }}>Avbryt</button>}
        </div>
      ) : (
        <div className="rad tv-knappar">
          <button type="button" className="knapp lank" onClick={() => setAndrar(true)}>Ändra</button>
          <button type="button" className="knapp lank" onClick={() => void valj(null)} disabled={lage === 'sparar'}>Ångra valet</button>
        </div>
      )}
      {falt && (
        <form className="tv-falt" onSubmit={(e) => { e.preventDefault(); if (falt === 'system') void valj('har_system', text); else void sparaDoman(falt); }}>
          <label htmlFor={idBas + '-text'} className="liten">{falt === 'system' ? 'Vilket system använder ni?' : falt === 'har_system' ? 'Vilken domän har ni?' : 'Vilken domän vill ni ha?'}</label>
          <div className="rad tight">
            <input id={idBas + '-text'} className="falt" value={text} onChange={(e) => setText(e.target.value)} placeholder={falt === 'system' ? 'T.ex. namnet på tjänsten' : 'dittforetag.se'} autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode={falt === 'system' ? 'text' : 'url'} maxLength={falt === 'system' ? 80 : 120} />
            <button type="submit" className="knapp" disabled={lage === 'sparar' || !text.trim()}>{lage === 'sparar' ? 'Sparar …' : falt === 'system' ? 'Spara' : 'Kontrollera och spara'}</button>
          </div>
          {falt !== 'system' && <p className="liten dis">Vi läser bara öppna uppgifter om domänen. Inget köps och ingenting ändras hos er leverantör.</p>}
        </form>
      )}
      {!kompakt && (
        <details className="tv-mer">
          <summary>Vad Digitala gör och vad det kostar</summary>
          <p>{t.digitala}</p>
          <p><span className="etikett">Kostnad:</span> {t.kostnad}</p>
          <p><span className="etikett">Bra att veta:</span> {t.grans}</p>
        </details>
      )}
      <p className="status" role="status" aria-live="polite">{lage === 'sparar' ? 'Sparar …' : lage === 'sparat' ? 'Sparat' : ''}</p>
      {fel && <p className="not fel" role="alert">{fel}</p>}
    </div>
  );
}

/** Ett eget behov som inte finns i katalogen, med kundens egna ord. */
export function AnnatBehov({ setVy }: { setVy: (v: Vy) => void }) {
  const [text, setText] = useState('');
  const [lage, setLage] = useState<'' | 'sparar' | 'sparat' | 'fel'>('');
  const [fel, setFel] = useState('');
  async function spara(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setLage('sparar');
    setFel('');
    try {
      const r = await anropa<Svar>('/api/tillval', { method: 'POST', body: JSON.stringify({ tillval: 'annat', kundval: 'onskat', beskrivning: text, idempotens: nyNyckel() }) });
      setVy(r.vy);
      setText('');
      setLage('sparat');
    } catch (err) {
      setLage('fel');
      setFel((err as AnropsFel).message);
    }
  }
  return (
    <form className="annat-behov" onSubmit={(e) => void spara(e)}>
      <label htmlFor="annat-behov" className="liten">Något annat ni behöver? Beskriv med egna ord.</label>
      <div className="rad tight">
        <input id="annat-behov" className="falt" value={text} onChange={(e) => setText(e.target.value)} placeholder="T.ex. kunna sälja presentkort" maxLength={200} />
        <button type="submit" className="knapp sekundar" disabled={lage === 'sparar' || !text.trim()}>{lage === 'sparar' ? 'Sparar …' : 'Lägg till'}</button>
      </div>
      <p className="status" role="status" aria-live="polite">{lage === 'sparat' ? 'Sparat' : ''}</p>
      {fel && <p className="not fel" role="alert">{fel}</p>}
    </form>
  );
}
