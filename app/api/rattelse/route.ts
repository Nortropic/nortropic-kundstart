import { NextResponse } from 'next/server';
import { Vagrad, registreraRattelse } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

export async function POST(req: Request) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const d = (await req.json().catch(() => ({}))) as { nyckel?: string; varde?: string; idempotens?: string };
  try {
    const r = await registreraRattelse(s.a.id, { nyckel: String(d.nyckel || ''), varde: String(d.varde || ''), idempotens: String(d.idempotens || '') });
    return NextResponse.json({ ok: true, ny: r.ny, vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
