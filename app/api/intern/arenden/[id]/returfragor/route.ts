import { NextResponse } from 'next/server';
import { kravInternNyckel } from '@/lib/intern';
import { returfragor } from '@/lib/overlamning';
import { Vagrad } from '@/lib/arende';
export async function POST(req: Request, ctx: { params: Promise<{ id: string; mid?: string }> }) {
  const nek = kravInternNyckel(req); if (nek) return nek;
  const { id } = await ctx.params;
  if (!/^ar_[A-Za-z0-9_-]+$/.test(id)) return NextResponse.json({ meddelande: 'ärendet finns inte' }, { status: 404 });
  try {
    const d = await req.json();
    const a = await returfragor(id, d);
    return NextResponse.json({ ok: true, revision: a.revision, signal: a.signal, returfragor: a.returfragor || [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status }); throw e; }
}
