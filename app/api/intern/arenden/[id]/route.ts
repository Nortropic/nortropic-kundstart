import { NextResponse } from 'next/server';
import { lasArende } from '@/lib/arende';
import { kravInternNyckel } from '@/lib/intern';
import { tillVy } from '@/lib/vy';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const nek = kravInternNyckel(req);
  if (nek) return nek;
  const { id } = await ctx.params;
  const a = await lasArende(id);
  if (!a) return NextResponse.json({ meddelande: 'ärendet finns inte' }, { status: 404 });
  return NextResponse.json({ ok: true, vy: tillVy(a), ai: a.ai, inlamningar: a.inlamningar });
}
