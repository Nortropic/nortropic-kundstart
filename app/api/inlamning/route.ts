import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Vagrad, lamnaIn } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

/** Inlämningen bär kundens samtycke: exakt den text som visades, bekräftad, och att intervjun lästs igenom. */
const Kropp = z.object({
  idempotens: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  samtycke: z.object({ version: z.literal('samtycke/1'), text: z.string().max(300), bekraftat: z.literal(true), transkript_last: z.literal(true) }),
});

export async function POST(req: Request) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const k = Kropp.safeParse(await req.json().catch(() => ({})));
  if (!k.success) return NextResponse.json({ meddelande: 'samtycke saknas eller är ofullständigt; ladda om sidan och läs igenom intervjun igen' }, { status: 400 });
  try {
    const a = await lamnaIn(s.a.id, k.data);
    return NextResponse.json({ ok: true, vy: tillVy(a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
