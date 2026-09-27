// Serverns läsning av kundens session: kakan verifieras, länken kontrolleras mot lagret (återkallad? utgången?)
// och ärendet läses. Ett synligt ärende-id är aldrig behörighet.
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { KAKA, hashaToken, lasSessionsKaka } from './atkomst';
import { lankGiltig, lasArende, lasLank } from './arende';
import type { Arende } from './typer';

export type SessionsFel = 'ingen' | 'ogiltig' | 'aterkallad' | 'utgangen' | 'saknas';

export async function hamtaSession(): Promise<{ a: Arende; hash: string } | { fel: SessionsFel }> {
  const jar = await cookies();
  const d = lasSessionsKaka(jar.get(KAKA)?.value);
  if (!d) return { fel: 'ingen' };
  const l = await lasLank(d.l);
  if (!l) return { fel: 'ogiltig' };
  if (l.aterkallad) return { fel: 'aterkallad' };
  if (!lankGiltig(l)) return { fel: 'utgangen' };
  if (l.arende_id !== d.a) return { fel: 'ogiltig' };
  const a = await lasArende(d.a);
  if (!a) return { fel: 'saknas' };
  return { a, hash: d.l };
}

export function felSvar(fel: SessionsFel): NextResponse {
  return NextResponse.json({ fel, meddelande: 'Länken gäller inte längre. Öppna er personliga länk igen eller be er kontakt om en ny.' }, { status: 401 });
}

export { hashaToken };
