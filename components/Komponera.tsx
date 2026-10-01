'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AnropsFel, anropa, lasUtkast, medInnehall, nyNyckel, sparaUtkast } from '@/lib/klient';
import type { ProvVy } from '@/lib/provlage';
import type { FragaVy, Vy } from '@/lib/vy';
import { Ikon } from './Ikon';
import ModellVal from './ModellVal';

type SvarSvar = { ok: true; ny: boolean; sparat: string; vy: Vy };

/** Testlägets kommandon, som i förbättringspartnern: /model [namn] och /effort [nivå]. Skickas aldrig som svar. */
const KOMMANDO = /^\s*\/(model|modell|effort)(?:\s+(.+?))?\s*$/i;

/** Hittar en modell ur ett skrivet namn: exakt namn eller id först, sedan början av namnet, sedan del av namnet. */
function hittaModell(prov: ProvVy, text: string): string | undefined {
  const t = text.trim().toLowerCase();
  const m = prov.modeller;
  return (m.find((x) => x.namn.toLowerCase() === t || x.id === t) || m.find((x) => x.namn.toLowerCase().startsWith(t)) || m.find((x) => x.namn.toLowerCase().includes(t) || x.id.includes(t)))?.id;
}

/**
 * Skrivrutan: bara en textruta och Skicka. Utkastet ligger i sessionStorage tills det skickats; en nyckel per fråga
 * och innehåll gör återförsök och dubbelklick ofarliga. "Vet inte", "gäller inte oss" och "återkom" sägs i ord;
 * servern känner igen ett helt "vet inte"-svar. I samtalsläget ligger rutan fast längst ned ('fast').
 */
export default function Komponera({ fraga, vy, onSparat, fast, placeholder = 'Skriv med egna ord', onUtkast }: { fraga: FragaVy; vy: Vy; onSparat: (v: Vy) => void; fast: boolean; placeholder?: string; onUtkast?: (text: string) => void }) {
  const router = useRouter();
  const nyckel = vy.arende.id + ':' + fraga.id;
  const [text, setText] = useState('');
  const [idempotens, setIdempotens] = useState('');
  const [lage, setLage] = useState<'tom' | 'osparad' | 'sparar' | 'sparat' | 'fel'>('tom');
  const [fel, setFel] = useState('');
  // Testläget (bara lokalt, aldrig för kunder): modell och ansträngning väljs i rutan.
  const [prov, setProv] = useState<ProvVy | undefined>(vy.ai.prov);
  const [provOppen, setProvOppen] = useState(false);
  const [provStatus, setProvStatus] = useState('');

  useEffect(() => {
    const u = lasUtkast(nyckel);
    if (u) {
      // sessionStorage är extern browserstatus; utkast återställs efter hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(u.text);
      setIdempotens(u.idempotens);
      if (u.text) setLage('osparad');
      onUtkast?.(u.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- utkastet läses en gång per fråga
  }, [nyckel]);

  function andra(t: string) {
    setText(t);
    const id = idempotens || nyNyckel();
    if (!idempotens) setIdempotens(id);
    sparaUtkast(nyckel, { text: t, idempotens: id });
    setLage(t.trim() ? 'osparad' : 'tom');
    onUtkast?.(t);
  }

  async function skicka() {
    if (lage === 'sparar') return;
    // Testlägets /model och /effort sparas aldrig som svar.
    if (kommando(text)) return;
    if (!text.trim()) return;
    // En nyckel per fråga och försök: samma nyckel vid återförsök, så ett återförsök eller dubbelklick aldrig ger två rader.
    const id = idempotens || nyNyckel();
    if (!idempotens) {
      setIdempotens(id);
      sparaUtkast(nyckel, { text, idempotens: id });
    }
    setLage('sparar');
    setFel('');
    try {
      const r = await anropa<SvarSvar>('/api/svar', { method: 'POST', body: JSON.stringify({ fraga_id: fraga.id, text, typ: 'text', idempotens: medInnehall(id, 'text|' + text) }) });
      sparaUtkast(nyckel, null);
      setLage('sparat');
      onUtkast?.('');
      onSparat(r.vy);
    } catch (e) {
      const f = e as AnropsFel;
      setLage('fel');
      setFel(f.message);
      if (f.status === 401) router.push('/lank?skal=session');
    }
  }

  // Den fasta rutans verkliga höjd blir sidans marginal nedtill, så att det som får fokus inte hamnar bakom rutan.
  const dockRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = dockRef.current;
    if (!fast || !el || typeof ResizeObserver === 'undefined') return;
    const rot = document.documentElement;
    const ro = new ResizeObserver(() => rot.style.setProperty('--dock-h', Math.ceil(el.getBoundingClientRect().height) + 'px'));
    ro.observe(el);
    return () => { ro.disconnect(); rot.style.removeProperty('--dock-h'); };
  }, [fast]);

  async function bytProv(modell: string, anstrangning: string) {
    if (!prov) return;
    // Valet visas direkt (radioknapparna följer det) och återställs om servern inte sparar det.
    const fore = prov;
    setProv({ ...prov, modell, anstrangning: anstrangning as ProvVy['anstrangning'], namn: prov.modeller.find((m) => m.id === modell)?.namn || modell });
    try {
      const r = await anropa<{ ok: true } & ProvVy>('/api/prov/installningar', { method: 'POST', headers: { 'x-kundstart-prov': '1' }, body: JSON.stringify({ modell, anstrangning }) });
      setProv(r);
      setProvStatus(`${r.namn} · ${r.anstrangning} gäller från nästa fråga.`);
    } catch (e) {
      setProv(fore);
      setProvStatus('Kunde inte byta: ' + (e as AnropsFel).message);
    }
  }

  /** /model och /effort i testläget: utan argument öppnas menyn, med argument byts valet direkt. */
  function kommando(text: string): boolean {
    const m = prov && KOMMANDO.exec(text);
    if (!prov || !m) return false;
    const arg = (m[2] || '').trim();
    if (!arg) {
      setProvOppen(true);
    } else if (m[1].toLowerCase() === 'effort') {
      if (prov.nivaer.includes(arg.toLowerCase())) void bytProv(prov.modell, arg.toLowerCase());
      else setProvStatus(`Okänd nivå: ${arg}. Välj ${prov.nivaer.join(', ')}.`);
    } else {
      const id = hittaModell(prov, arg);
      if (id) void bytProv(id, prov.anstrangning);
      else setProvStatus(`Okänd modell: ${arg}. Välj ${prov.modeller.map((x) => x.namn).join(', ')}.`);
    }
    andra('');
    return true;
  }

  const statusText = lage === 'sparar' ? 'Sparar …' : lage === 'osparad' ? 'Inte skickat än' : lage === 'sparat' ? 'Sparat' : '';
  const sparar = lage === 'sparar';

  return (
    <div className={'komponera' + (fast ? ' fast' : '')} ref={dockRef}>
      <div className="ruta">
        <label className="sr" htmlFor={'svar-' + fraga.id}>Ert svar</label>
        <textarea id={'svar-' + fraga.id} className="svar-falt" rows={2} value={text} onChange={(e) => andra(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void skicka(); } }}
          placeholder={placeholder} enterKeyHint="send" autoCapitalize="sentences" />
        <div className="ruta-rad">
          <button type="button" className="knapp skicka" aria-label={sparar ? undefined : 'Skicka svar'} onClick={() => void skicka()} disabled={sparar || !text.trim()}>
            {sparar ? 'Sparar …' : <><span className="skicka-text" aria-hidden="true">Skicka</span><Ikon namn="upp" /></>}
          </button>
          {prov && <ModellVal prov={prov} oppen={provOppen} setOppen={setProvOppen} byt={(m, n) => void bytProv(m, n)} status={provStatus} />}
        </div>
      </div>
      <p className="komponera-hint dis liten">Vet inte, gäller inte er, eller vill ni återkomma? Skriv det, så tar vi hänsyn till det.</p>
      <p className={'status ' + lage} role="status" aria-live="polite">{statusText}</p>
      {fel && (
        <p className="not fel" role="alert">
          Inte sparat: {fel} <button type="button" className="knapp lank inline" onClick={() => void skicka()}>Försök igen</button>
        </p>
      )}
    </div>
  );
}
