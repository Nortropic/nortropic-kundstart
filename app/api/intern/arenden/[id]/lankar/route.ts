import { NextResponse } from 'next/server';
import { Vagrad, skapaLank } from '@/lib/arende';
import { kravInternNyckel } from '@/lib/intern';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const nek = kravInternNyckel(req);
  if (nek) return nek;
  const { id } = await ctx.params;
  const d = (await req.json().catch(() => ({}))) as { lank_dagar?: number; bas_url?: string };
  try {
    const l = await skapaLank(id, d.lank_dagar || 30);
    const bas = (d.bas_url || new URL(req.url).origin).replace(/\/$/, '');
    return NextResponse.json({ ok: true, lank: `${bas}/start#${l.token}`, lank_hash: l.hash, utgar: l.utgar }, { status: 201 });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
