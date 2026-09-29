import { NextResponse } from 'next/server';
import { provTillatet, provVy, sparaProv } from '@/lib/provlage';
import { felSvar, hamtaSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Testlägets modell och ansträngning (som i förbättringspartnern). Finns bara på den lokala servern som startats med
 * KUNDSTART_AI=claude-cli, aldrig på Vercel. Kräver ett öppet ärende (ägarens provlänk) och, för ändringar, ytans eget
 * huvud, så att en annan webbplats inte kan byta valet i ägarens webbläsare.
 */
export async function GET() {
  if (!provTillatet()) return NextResponse.json({ ok: false, fel: 'finns inte' }, { status: 404 });
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  return NextResponse.json({ ok: true, ...provVy() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!provTillatet()) return NextResponse.json({ ok: false, fel: 'finns inte' }, { status: 404 });
  if (req.headers.get('x-kundstart-prov') !== '1') return NextResponse.json({ ok: false, fel: 'fel ursprung' }, { status: 403 });
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const d = (await req.json().catch(() => ({}))) as { modell?: unknown; anstrangning?: unknown };
  try {
    sparaProv(String(d.modell || ''), String(d.anstrangning || ''));
  } catch (e) {
    return NextResponse.json({ ok: false, fel: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...provVy() }, { headers: { 'Cache-Control': 'no-store' } });
}
