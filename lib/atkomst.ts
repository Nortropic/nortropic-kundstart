// Åtkomst: kundbunden länk (256 bitars slump, bara hashen lagras), signerad httpOnly-kaka efter första besöket,
// och en intern nyckel för Digitalas verktyg. Länkens värde skrivs aldrig i loggar eller svar.
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { SessionsData } from './typer';

export const KAKA = 'kundstart';
const SESSION_DAGAR = 30;

function hemlighet(): string {
  const h = process.env.KUNDSTART_HEMLIGHET;
  if (!h || h.length < 32) throw new Error('KUNDSTART_HEMLIGHET saknas eller är för kort');
  return h;
}

export function nyToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashaToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenSerRimligUt(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,48}$/.test(token);
}

export function nyttId(prefix: string): string {
  return prefix + '_' + randomBytes(9).toString('base64url');
}

function signera(data: string): string {
  return createHmac('sha256', hemlighet()).update(data).digest('base64url');
}

export function skapaSessionsKaka(d: SessionsData): string {
  const del = Buffer.from(JSON.stringify(d)).toString('base64url');
  return del + '.' + signera(del);
}

export function lasSessionsKaka(varde: string | undefined): SessionsData | null {
  if (!varde) return null;
  const i = varde.lastIndexOf('.');
  if (i < 1) return null;
  const del = varde.slice(0, i);
  const sig = varde.slice(i + 1);
  const ratt = signera(del);
  if (sig.length !== ratt.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(ratt))) return null;
  try {
    const d = JSON.parse(Buffer.from(del, 'base64url').toString('utf8')) as SessionsData;
    if (typeof d.a !== 'string' || typeof d.l !== 'string' || typeof d.exp !== 'number') return null;
    if (d.exp * 1000 < Date.now()) return null;
    return d;
  } catch {
    return null;
  }
}

export function sessionsUtgang(): number {
  return Math.floor(Date.now() / 1000) + SESSION_DAGAR * 86400;
}

export function kakAttribut(): { httpOnly: true; sameSite: 'lax'; secure: boolean; path: string; maxAge: number } {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_DAGAR * 86400 };
}

export function internNyckelOk(authorization: string | null): boolean {
  const nyckel = process.env.KUNDSTART_INTERN_NYCKEL;
  if (!nyckel || nyckel.length < 32 || !authorization) return false;
  const m = /^Bearer\s+(\S+)$/.exec(authorization);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(nyckel);
  return a.length === b.length && timingSafeEqual(a, b);
}
