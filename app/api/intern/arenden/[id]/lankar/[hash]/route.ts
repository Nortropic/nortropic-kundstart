import { NextResponse } from 'next/server';
import { aterkallaLank, lasLank } from '@/lib/arende';
import { kravInternNyckel } from '@/lib/intern';

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; hash: string }> }) {
  const nek = kravInternNyckel(req);
  if (nek) return nek;
  const { id, hash } = await ctx.params;
  const l = await lasLank(hash);
  if (!l || l.arende_id !== id) return NextResponse.json({ meddelande: 'länken finns inte' }, { status: 404 });
  const r = await aterkallaLank(hash);
  return NextResponse.json({ ok: true, aterkallad: r.aterkallad });
}
