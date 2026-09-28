import { NextResponse } from 'next/server';
import { kravInternNyckel } from '@/lib/intern';
import { signaler } from '@/lib/overlamning';
export async function GET(req: Request) { const nek = kravInternNyckel(req); if (nek) return nek; return NextResponse.json(await signaler(new URL(req.url).searchParams.get('cursor') || undefined), { headers: { 'Cache-Control': 'no-store' } }); }
