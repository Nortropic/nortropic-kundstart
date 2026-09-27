import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { Vagrad, laggMaterialFil, laggMaterialLank } from '@/lib/arende';
import { MAX_FIL, TILLATNA_ANDELSER, identifiera, rimligLank, sakertFilnamn } from '@/lib/material';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

export const maxDuration = 60;

export async function POST(req: Request) {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  try {
    const typ = req.headers.get('content-type') || '';
    if (typ.startsWith('application/json')) {
      const d = (await req.json().catch(() => ({}))) as { url?: string; beskrivning?: string; idempotens?: string };
      const url = String(d.url || '').trim();
      if (!rimligLank(url)) throw new Vagrad('Ange en fullständig webbadress som börjar med https://');
      const r = await laggMaterialLank(s.a.id, { url, beskrivning: String(d.beskrivning || ''), idempotens: String(d.idempotens || '') });
      return NextResponse.json({ ok: true, ny: r.ny, vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const form = await req.formData();
    const fil = form.get('fil');
    const idempotens = String(form.get('idempotens') || '');
    const beskrivning = String(form.get('beskrivning') || '');
    if (!(fil instanceof File)) throw new Vagrad('Ingen fil kom med.');
    if (fil.size === 0) throw new Vagrad('Filen är tom.');
    if (fil.size > MAX_FIL) throw new Vagrad('Filen är större än 4 MB. Förminska den eller dela upp den, så tar vi emot den.', 413);
    const data = await fil.arrayBuffer();
    const bytes = new Uint8Array(data);
    const filnamn = sakertFilnamn(fil.name);
    const t = identifiera(filnamn, bytes);
    if (!t) throw new Vagrad(`Vi tar emot ${TILLATNA_ANDELSER.join(', ')}. Filen ${filnamn} ser inte ut som en sådan fil.`, 415);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const r = await laggMaterialFil(s.a.id, { filnamn, mime: t.mime, data, sha256, beskrivning, idempotens });
    return NextResponse.json({ ok: true, ny: r.ny, vy: tillVy(r.a) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Vagrad) return NextResponse.json({ meddelande: e.message }, { status: e.status });
    throw e;
  }
}
