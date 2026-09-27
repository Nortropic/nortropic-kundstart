import { NextResponse } from 'next/server';
import { Vagrad, registreraSvar } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

export async function POST(req: Request) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const d = (await req.json().catch(() => ({}))) as { fraga_id?: string; text?: string; typ?: 'text' | 'vet_inte' | 'val'; idempotens?: string };
  try {
    const r = await registreraSvar(s.a.id, { fraga_id: String(d.fraga_id || ''), text: String(d.text || ''), typ: d.typ === 'vet_inte' || d.typ === 'val' ? d.typ : 'text', idempotens: String(d.idempotens || '') });
    return NextResponse.json({ ok: true, ny: r.ny, sparat: new Date().toISOString(), vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
