import { NextResponse } from 'next/server';
import { Vagrad, sattTillval } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import type { TillvalKundval } from '@/lib/typer';
import { tillVy } from '@/lib/vy';

/** Kundens eget val av ett tillval i kontrollerna. kundval null ångrar valet; historiken bevaras. */
export async function POST(req: Request) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const d = (await req.json().catch(() => ({}))) as { tillval?: string; kundval?: TillvalKundval | null; system?: string; beskrivning?: string; not?: string; idempotens?: string };
  try {
    const kundval = d.kundval === null ? null : (['onskat', 'har_system', 'hjalp', 'inte_nu'].includes(String(d.kundval)) ? d.kundval as TillvalKundval : undefined);
    if (kundval === undefined) throw new Vagrad('okänt val');
    const r = await sattTillval(s.a.id, { tillval: String(d.tillval || ''), kundval, system: d.system, beskrivning: d.beskrivning, not: d.not, idempotens: String(d.idempotens || '') });
    return NextResponse.json({ ok: true, ny: r.ny, tillval: r.tillval, sparat: new Date().toISOString(), vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
