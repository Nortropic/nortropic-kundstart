import { NextResponse } from 'next/server';
import { felSvar, hamtaSession } from '@/lib/session';
import { tillVy } from '@/lib/vy';

export async function GET() {
  const s = await hamtaSession();
  if ('fel' in s) return felSvar(s.fel);
  return NextResponse.json(tillVy(s.a), { headers: { 'Cache-Control': 'no-store' } });
}
