import { NextResponse } from 'next/server';
import { budgetLage } from '@/lib/budget';
import { kravInternNyckel } from '@/lib/intern';

/** Kostnadskontrollens läge: konfigurerade tak och månadens bokföring (faktisk kostnad, okänd förbrukning, vägrade anrop). */
export async function GET(req: Request) {
  const nek = kravInternNyckel(req);
  if (nek) return nek;
  const l = await budgetLage();
  return NextResponse.json({ ok: true, granser: l.granser, manad: l.manad ? { ...l.manad, reservationer: l.manad.reservationer.length } : null }, { headers: { 'Cache-Control': 'no-store' } });
}
