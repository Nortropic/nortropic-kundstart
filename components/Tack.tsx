'use client';
import { klockslag } from '@/lib/klient';
import type { Vy } from '@/lib/vy';
import { Marke } from './Ikon';

/** Tacksidan efter inlämningen: vad som lämnats och vad som händer nu. Ingen e-post skickas; kontakten hör av sig. */
export default function Tack({ vy, visaLamnat }: { vy: Vy; visaLamnat: () => void }) {
  const i = vy.arende.inlamnad;
  const valda = vy.uppdrag.valda;
  return (
    <div className="tack">
      <div className="tack-ikon"><Marke storlek={40} /></div>
      <h1>Tack, {vy.arende.kund.namn}.</h1>
      <p>Det ni berättat blir grunden för er webbplats.</p>
      {i && (
        <>
          <p>Det här lämnade ni {klockslag(i.tid)}:</p>
          <ul>
            <li>{i.svar} svar i samtalet</li>
            <li>{i.material} {i.material === 1 ? 'fil eller länk' : 'filer och länkar'}</li>
            <li>{valda.length ? `${valda.length} tillval: ${valda.map((t) => `${t.namn} (${(t.kundval_text || '').toLowerCase()})`).join(', ')}` : 'inga valda tillval'}</li>
          </ul>
        </>
      )}
      <h2 className="liten-rubrik">Vad som händer nu</h2>
      <p>{vy.overlamning} Er kontakt hos Nortropic hör av sig när underlaget är genomgånget eller om något behöver kompletteras. Kompletterande frågor visas här när ni öppnar länken igen.</p>
      <p className="dis liten">Det här är underlag till ert uppdrag, inte ett godkännande av en design, ett köp av tillval eller ett avtal om fler tjänster.</p>
      <div className="rad">
        <button type="button" className="knapp sekundar" onClick={visaLamnat}>Visa det ni lämnat</button>
      </div>
    </div>
  );
}
