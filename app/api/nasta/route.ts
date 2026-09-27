import { NextResponse } from 'next/server';
import { Vagrad, nasta } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { fragaVy, tillVy } from '@/lib/vy';

export const maxDuration = 60;

export async function POST() {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  try {
    const r = await nasta(s.a.id);
    return NextResponse.json({ ok: true, klar: r.klar, meddelande: r.meddelande, ai: r.ai, fragor: r.fragor.map(fragaVy), vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
