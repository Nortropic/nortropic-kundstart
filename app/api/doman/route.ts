import { NextResponse } from 'next/server';
import { Vagrad, sattDoman } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

export const maxDuration = 30;

/** Domänflödet: spara befintlig eller önskad domän och läs dess öppna uppgifter i samma handling. */
export async function POST(req: Request) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const d = (await req.json().catch(() => ({}))) as { doman?: string; kundval?: string; idempotens?: string };
  try {
    if (d.kundval !== 'har_system' && d.kundval !== 'onskat') throw new Vagrad('okänt val');
    const r = await sattDoman(s.a.id, { doman: String(d.doman || ''), kundval: d.kundval, idempotens: String(d.idempotens || '') });
    return NextResponse.json({ ok: true, ny: r.ny, sparat: new Date().toISOString(), vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
