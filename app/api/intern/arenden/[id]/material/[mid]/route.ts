import { NextResponse } from 'next/server';
import { lasArende } from '@/lib/arende';
import { kravInternNyckel } from '@/lib/intern';
import { hamtaFil } from '@/lib/lagring';

export async function GET(req: Request, ctx: { params: Promise<{ id: string; mid: string }> }) {
  const nek = kravInternNyckel(req);
  if (nek) return nek;
  const { id, mid } = await ctx.params;
  const a = await lasArende(id);
  const m = a?.material.find((x) => x.id === mid && x.status === 'mottagen' && x.typ === 'fil' && x.blob);
  if (!a || !m) return NextResponse.json({ meddelande: 'filen finns inte' }, { status: 404 });
  const f = await hamtaFil(m.blob!);
  if (!f) return NextResponse.json({ meddelande: 'filen finns inte' }, { status: 404 });
  return new Response(f.stream, {
    headers: { 'Content-Type': m.mime || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(m.filnamn || 'fil')}`, 'X-Kundstart-Sha256': m.sha256 || '', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
