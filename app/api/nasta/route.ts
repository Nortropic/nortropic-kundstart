import { NextResponse } from 'next/server';
import { Vagrad, nasta } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { fragaVy, tillVy } from '@/lib/vy';

export const maxDuration = 60;

/** Nästa steg i samtalet. {fortsatt:true} öppnar ett avslutat samtal igen på kundens begäran. */
export async function POST(req: Request) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const d = (await req.json().catch(() => ({}))) as { fortsatt?: boolean };
  try {
    const r = await nasta(s.a.id, { fortsatt: d.fortsatt === true });
    return NextResponse.json({ ok: true, klar: r.klar, vantar: Boolean(r.vantar), forkastad: Boolean(r.forkastad), meddelande: r.meddelande, ai: { lage: r.ai.lage, anvand: r.ai.anvand, fallback: r.ai.fallback, fel: r.ai.fel }, fragor: r.fragor.map(fragaVy), vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
