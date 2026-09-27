import { NextResponse } from 'next/server';
import { taBortMaterial } from '@/lib/arende';
import { hamtaFil } from '@/lib/lagring';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const { id } = await ctx.params;
  const m = s.a.material.find((x) => x.id === id && x.status === 'mottagen' && x.typ === 'fil' && x.blob);
  if (!m) return NextResponse.json({ meddelande: 'Filen finns inte' }, { status: 404 });
  const f = await hamtaFil(m.blob!);
  if (!f) return NextResponse.json({ meddelande: 'Filen finns inte' }, { status: 404 });
  const namn = encodeURIComponent(m.filnamn || 'fil');
  return new Response(f.stream, {
    headers: {
      'Content-Type': m.mime || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${namn}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(f.size ? { 'Content-Length': String(f.size) } : {}),
    },
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const { id } = await ctx.params;
  const a = await taBortMaterial(s.a.id, id);
  return NextResponse.json({ ok: true, vy: tillVy(a) }, { headers: { 'Cache-Control': 'no-store' } });
}
