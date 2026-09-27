import { NextResponse } from 'next/server';
import { KAKA, hashaToken, kakAttribut, sessionsUtgang, skapaSessionsKaka, tokenSerRimligUt } from '@/lib/atkomst';
import { lasLank, noteraLankAnvand } from '@/lib/arende';

export async function POST(req: Request) {
  const d = (await req.json().catch(() => ({}))) as { token?: string };
  const token = typeof d.token === 'string' ? d.token.trim() : '';
  if (!tokenSerRimligUt(token)) return NextResponse.json({ skal: 'ogiltig' }, { status: 404 });
  const hash = hashaToken(token);
  // En nyss skapad länk kan dröja någon sekund i lagret; tre läsningar innan länken kallas ogiltig.
  let l = await lasLank(hash);
  for (const paus of [300, 700]) {
    if (l) break;
    await new Promise((r) => setTimeout(r, paus));
    l = await lasLank(hash);
  }
  if (!l) return NextResponse.json({ skal: 'ogiltig' }, { status: 404 });
  if (l.aterkallad) return NextResponse.json({ skal: 'aterkallad' }, { status: 410 });
  if (new Date(l.utgar).getTime() <= Date.now()) return NextResponse.json({ skal: 'utgangen' }, { status: 410 });
  await noteraLankAnvand(hash).catch(() => undefined);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(KAKA, skapaSessionsKaka({ a: l.arende_id, l: hash, exp: sessionsUtgang() }), kakAttribut());
  return res;
}
