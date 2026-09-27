// Intern API för Digitalas verktyg (kundstart.py): bärarnyckel, aldrig kundens session.
import { NextResponse } from 'next/server';
import { internNyckelOk } from './atkomst';

export function kravInternNyckel(req: Request): NextResponse | null {
  if (internNyckelOk(req.headers.get('authorization'))) return null;
  return NextResponse.json({ meddelande: 'intern nyckel saknas eller är fel' }, { status: 401 });
}
