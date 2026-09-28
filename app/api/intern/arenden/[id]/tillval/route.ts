import { NextResponse } from 'next/server';
import { Vagrad, sattTillvalDigitala } from '@/lib/arende';
import { kravInternNyckel } from '@/lib/intern';
import type { TillvalDigitala } from '@/lib/typer';

/** Digitalas status för ett tillval: inkluderat, vantar_atkomst, anslutet_provat eller null. Administrativt, ingen ny kundrevision. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const nek = kravInternNyckel(req);
  if (nek) return nek;
  const { id } = await ctx.params;
  const d = (await req.json().catch(() => ({}))) as { tillval?: string; status?: TillvalDigitala | null; not?: string; kalla?: string; utforare?: string; idempotens?: string };
  try {
    const status = d.status === null ? null : (['inkluderat', 'vantar_atkomst', 'anslutet_provat'].includes(String(d.status)) ? d.status as TillvalDigitala : undefined);
    if (status === undefined) throw new Vagrad('okänd status');
    const a = await sattTillvalDigitala(id, { tillval: String(d.tillval || ''), status, not: String(d.not || ''), kalla: String(d.kalla || ''), utforare: String(d.utforare || ''), idempotens: String(d.idempotens || '') });
    return NextResponse.json({ ok: true, tillval: (a.tillval || []).find((t) => t.id === d.tillval) || null });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
