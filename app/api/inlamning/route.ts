import { NextResponse } from 'next/server';
import { lamnaIn } from '@/lib/arende';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

export async function POST() {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  const a = await lamnaIn(s.a.id);
  return NextResponse.json({ ok: true, vy: tillVy(a) }, { headers: { 'Cache-Control': 'no-store' } });
}
