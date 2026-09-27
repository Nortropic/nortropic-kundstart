import { NextResponse } from 'next/server';
import { oppnaIgen, skjutUpp } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

/** Skjut upp en ställd fråga (kunden återkommer) eller öppna en uppskjuten fråga igen. */
export async function POST(req: Request) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const d = (await req.json().catch(() => ({}))) as { fraga_id?: string; oppna?: boolean };
  const a = d.oppna ? await oppnaIgen(s.a.id, String(d.fraga_id || '')) : await skjutUpp(s.a.id, String(d.fraga_id || ''));
  return NextResponse.json({ ok: true, vy: tillVy(a) }, { headers: { 'Cache-Control': 'no-store' } });
}
