import { NextResponse } from 'next/server';
import { Vagrad, avsluta } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

/** Kunden avslutar intervjun: med en aktiv intervjuare rundar den av (ett modellanrop), annars med fast text. */
export const maxDuration = 300;

export async function POST() {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  try {
    const r = await avsluta(s.a.id);
    return NextResponse.json({ ok: true, ny: r.ny, vantar: Boolean(r.vantar), vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
