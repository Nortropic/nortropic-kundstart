import { NextResponse } from 'next/server';
import { Vagrad, borja } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

/** "Börja intervjun": öppningsfrågan ställs utan modellanrop. Idempotent. */
export async function POST() {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  try {
    const r = await borja(s.a.id);
    return NextResponse.json({ ok: true, ny: r.ny, vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
