// Lokalt testläge, som förbättringspartnern: ägarens egna prov på den egna datorn, där varje tur körs med Claude Code
// på ägarens inloggning. Modell och ansträngning väljs i skrivrutan och sparas i en privat fil utanför repot. Aldrig på
// Vercel och aldrig för kunder: Anthropics villkor tillåter inte att en Pro- eller Max-inloggning svarar någon annans
// användare (Claude Code, Legal and compliance: "Authentication and credential use").
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Samma modeller och ordning som förbättringspartnerns val. */
export const MODELLER = [
  { id: 'claude-opus-5-5', namn: 'Opus 5.5', om: 'djupast förståelse' },
  { id: 'claude-fable-5-1', namn: 'Fable 5.1', om: 'egen kvot; tar den slut stoppas turen med ett besked' },
  { id: 'claude-sonnet-5', namn: 'Sonnet 5', om: 'snabbare, något grundare' },
  { id: 'claude-opus-5', namn: 'Opus 5', om: 'föregående Opus' },
  { id: 'claude-haiku-4-5-20251001', namn: 'Haiku 4.5', om: 'snabbast, svagast på djup förståelse' },
] as const;
export const NIVAER = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Niva = (typeof NIVAER)[number];

export interface ProvVal { modell: string; anstrangning: Niva }
export interface ProvVy extends ProvVal { namn: string; modeller: { id: string; namn: string; om: string }[]; nivaer: string[]; syntes: ProvVal & { namn: string } }

/** Ägarens beslut 2026-10-01: Opus 5.5 på max som standard för både turen och sammanfattningen; sänks i skrivrutan vid behov. */
const STANDARD: ProvVal = { modell: 'claude-opus-5-5', anstrangning: 'max' };
const SYNTES_STANDARD: ProvVal = { modell: 'claude-opus-5-5', anstrangning: 'max' };

/** Testläget gäller bara den lokala servern som startats med KUNDSTART_AI=claude-cli, aldrig på Vercel. */
export function provTillatet(): boolean {
  return !process.env.VERCEL && process.env.KUNDSTART_AI === 'claude-cli';
}

function katalog(): string {
  return process.env.KUNDSTART_PROV_DATA || join(homedir(), '.nortropic-kundstart-prov');
}

function fil(): string {
  return join(katalog(), 'installningar.json');
}

export function modellNamn(id: string): string {
  return MODELLER.find((m) => m.id === id)?.namn || id;
}

function giltigt(d: unknown): Partial<ProvVal> {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
  const v = d as Record<string, unknown>;
  return {
    modell: MODELLER.some((m) => m.id === v.modell) ? (v.modell as string) : undefined,
    anstrangning: (NIVAER as readonly unknown[]).includes(v.anstrangning) ? (v.anstrangning as Niva) : undefined,
  };
}

function lasFil(): Record<string, unknown> | null {
  try {
    const d = JSON.parse(readFileSync(fil(), 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Ägarens val för turerna, eller standardvalet om filen saknas eller har okända värden. */
export function lasProv(): ProvVal {
  const v = giltigt(lasFil());
  return { modell: v.modell || STANDARD.modell, anstrangning: v.anstrangning || STANDARD.anstrangning };
}

/** Ägarens val för sammanfattningen (syntes_modell, syntes_anstrangning i samma fil), annars standardvalet. */
export function lasSyntesProv(): ProvVal {
  const d = lasFil();
  const v = giltigt(d ? { modell: d.syntes_modell, anstrangning: d.syntes_anstrangning } : null);
  return { modell: v.modell || SYNTES_STANDARD.modell, anstrangning: v.anstrangning || SYNTES_STANDARD.anstrangning };
}

function kontrollera(modell: string, anstrangning: string) {
  if (!MODELLER.some((m) => m.id === modell)) throw new Error('okänd modell');
  if (!(NIVAER as readonly string[]).includes(anstrangning)) throw new Error('okänd ansträngning');
}

/** Sparar ett nytt val atomärt (0600) och lämnar filens övriga nycklar orörda. En oläsbar fil skrivs aldrig över. */
export function sparaProv(modell: string, anstrangning: string, syntes?: { modell: string; anstrangning: string }): ProvVal {
  kontrollera(modell, anstrangning);
  if (syntes) kontrollera(syntes.modell, syntes.anstrangning);
  const dir = katalog();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  let ovrigt: Record<string, unknown> = {};
  if (existsSync(fil())) {
    const d = lasFil();
    if (!d) throw new Error('installningar.json går inte att läsa; rätta eller ta bort filen först');
    ovrigt = d;
  }
  const tmp = join(dir, '.installningar.json.tmp');
  const nytt = { ...ovrigt, modell, anstrangning, ...(syntes ? { syntes_modell: syntes.modell, syntes_anstrangning: syntes.anstrangning } : {}), andrad: new Date().toISOString() };
  writeFileSync(tmp, JSON.stringify(nytt, null, 1) + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, fil());
  return lasProv();
}

export function provVy(): ProvVy {
  const v = lasProv();
  const s = lasSyntesProv();
  return { ...v, namn: modellNamn(v.modell), modeller: MODELLER.map((m) => ({ ...m })), nivaer: [...NIVAER], syntes: { ...s, namn: modellNamn(s.modell) } };
}

/** Hur länge en tur får ta: högre ansträngning tänker längre. */
export function turTimeoutMs(anstrangning: string): number {
  return anstrangning === 'max' || anstrangning === 'xhigh' ? 300_000 : anstrangning === 'high' ? 240_000 : 170_000;
}

/** Sammanfattningen läser hela intervjun och citerar ordagrant; taket är transportens hårda gräns. */
export function syntesTimeoutMs(): number {
  return 300_000;
}
