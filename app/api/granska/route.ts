import { NextResponse } from 'next/server';
import { Vagrad, granska } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

/** Till granskningen: sammanfattningen skrivs (ett modellanrop i testläget; deterministiskt utan modell). {igen:true} skriver om den. */
export const maxDuration = 300;

export async function POST(req: Request) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const d = (await req.json().catch(() => ({}))) as { igen?: boolean };
  try {
    const r = await granska(s.a.id, { igen: d.igen === true });
    return NextResponse.json({ ok: true, utford: r.utford, fallback: r.fallback, vantar: Boolean(r.vantar), forkastad: Boolean(r.forkastad), fel: r.fel, vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
