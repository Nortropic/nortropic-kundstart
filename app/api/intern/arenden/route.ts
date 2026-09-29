import { NextResponse } from 'next/server';
import { Vagrad, skapaArende } from '@/lib/arende';
import { kravInternNyckel } from '@/lib/intern';
import { arendelista } from '@/lib/overlamning';
import type { AiLage, Fakta } from '@/lib/typer';

/** Skapar ett ärende ur kundmappens kända uppgifter och ger en inbjudningslänk. Länkens värde returneras en gång. */
export async function POST(req: Request) {
  const nek = kravInternNyckel(req);
  if (nek) return nek;
  const d = (await req.json().catch(() => ({}))) as { kund?: { slug: string; namn: string }; kontakt?: string; kanal?: string; testdialog?: boolean; fakta?: Fakta[]; ai?: AiLage; lank_dagar?: number; bas_url?: string };
  try {
    if (!d.kund) throw new Vagrad('kund saknas');
    const { a, token, hash, utgar } = await skapaArende({ kund: d.kund, kontakt: d.kontakt, kanal: d.kanal, testdialog: d.testdialog, fakta: d.fakta, ai: d.ai, lank_dagar: d.lank_dagar });
    const bas = (d.bas_url || new URL(req.url).origin).replace(/\/$/, '');
    return NextResponse.json({ ok: true, arende_id: a.id, lank: `${bas}/start#${token}`, lank_hash: hash, utgar, ai: a.ai.lage }, { status: 201 });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}

/** Lista över ärendenas metadata (kundstart-arenden/1) för ägarens interna arbetsplats; ändrar ingenting. */
export async function GET(req: Request) {
  const nek = kravInternNyckel(req);
  if (nek) return nek;
  return NextResponse.json(await arendelista(new URL(req.url).searchParams.get('cursor') || undefined), { headers: { 'Cache-Control': 'no-store' } });
}
