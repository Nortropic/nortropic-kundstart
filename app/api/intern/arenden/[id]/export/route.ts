import { NextResponse } from 'next/server';
import { exportPaket, lasArende } from '@/lib/arende';
import { kravInternNyckel } from '@/lib/intern';

/** Versionerat exportpaket (kundstart-export/1): kundens svar ordagrant per omgång, rättelser, AI-tolkningar som
 * egna fakta-rader med status 'tolkning', material med hämtningsväg. Kundmappen (INTERVJU.json) är det auktoritativa hemmet. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const nek = kravInternNyckel(req);
  if (nek) return nek;
  const { id } = await ctx.params;
  const a = await lasArende(id);
  if (!a) return NextResponse.json({ meddelande: 'ärendet finns inte' }, { status: 404 });
  const bas = new URL(req.url).origin;
  const p = exportPaket(a);
  return NextResponse.json({ ...p, material: p.material.map((m) => ({ ...m, hamta: m.typ === 'fil' ? `${bas}/api/intern/arenden/${a.id}/material/${m.id}` : undefined })) }, { headers: { 'Cache-Control': 'no-store' } });
}
