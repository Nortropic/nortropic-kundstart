// Intervjuledaren: väljer nästa relevanta fråga bland kandidater ur Digitalas frågebank, avgör vilka kandidater ett
// öppet svar redan täcker och håller en kort bild av vad kunden sagt. Modellen får aldrig hitta på egna fråge-id,
// generera HTML eller skriva om kundens ord: servern validerar allt mot kandidatlistan och faller tillbaka till den
// regelstyrda vägen (samma luckor och följdregler som intervju.py) när modellen inte nås eller svarar ogiltigt.
//
// Tre transporter: 'gateway' (Vercel AI Gateway med OIDC eller AI_GATEWAY_API_KEY; skarpt läge på servern),
// 'claude-cli' (bara lokal verifiering i byggmiljön genom claude -p; vägrar på Vercel) och 'regelstyrd' (ingen modell).
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { AiLage } from './typer';

export interface Kandidat {
  id: string;
  omrade: string;
  nyckel: string;
  text: string;
  paverkar: string;
  prio: number;
  foljd: boolean;
  utlost_av?: string;
  senare?: boolean;
}

export interface LedarIndata {
  kund: { namn: string };
  kanda: { nyckel: string; varde: string; kalla: string }[];
  dialog: { fraga_id: string; fraga: string; svar: string }[];
  senaste: { fraga_id: string; fraga: string; svar: string } | null;
  kandidater: Kandidat[];
  material: number;
}

export interface LedarUtdata {
  valda: { id: string; text: string; typ: 'oppen' | 'val'; alternativ: string[] }[];
  tackta: { fraga_id: string; nyckel: string; varde: string }[];
  bild: { nyckel: string; varde: string }[];
  meddelande: string;
  klar: boolean;
}

export interface LedarResultat {
  utdata: LedarUtdata | null;
  lage: AiLage;
  modell?: string;
  tokens_in: number;
  tokens_out: number;
  fel?: string;
  ms: number;
  fallback: boolean;
}

export const STANDARD_MODELL = process.env.KUNDSTART_AI_MODELL || 'openai/gpt-5-mini';
const GATEWAY = 'https://ai-gateway.vercel.sh';
const MAX_TEXT = 320;
const MAX_VARDE = 400;
const MAX_MEDDELANDE = 240;

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    valda: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          typ: { type: 'string', enum: ['oppen', 'val'] },
          alternativ: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'text', 'typ', 'alternativ'],
      },
    },
    tackta: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { fraga_id: { type: 'string' }, nyckel: { type: 'string' }, varde: { type: 'string' } },
        required: ['fraga_id', 'nyckel', 'varde'],
      },
    },
    bild: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { nyckel: { type: 'string' }, varde: { type: 'string' } },
        required: ['nyckel', 'varde'],
      },
    },
    meddelande: { type: 'string' },
    klar: { type: 'boolean' },
  },
  required: ['valda', 'tackta', 'bild', 'meddelande', 'klar'],
} as const;

const Utdata = z.object({
  valda: z.array(z.object({ id: z.string(), text: z.string(), typ: z.enum(['oppen', 'val']), alternativ: z.array(z.string()) })),
  tackta: z.array(z.object({ fraga_id: z.string(), nyckel: z.string(), varde: z.string() })),
  bild: z.array(z.object({ nyckel: z.string(), varde: z.string() })),
  meddelande: z.string(),
  klar: z.boolean(),
});

export function systemText(): string {
  return [
    'Du är intervjuledare hos Nortropic Digitala i ett lugnt samtal med en kund om en ny eller förbättrad webbplats.',
    'Din uppgift: välj nästa relevanta fråga (högst två) bland KANDIDATERNA, med exakt deras id, och avgör vilka kandidater',
    'kundens senaste svar redan täcker (tackta) så att vi inte frågar igen. Skriv på enkel svenska i kundens ord.',
    'Omformulera gärna en kandidat så att den knyter an till vad kunden sagt, men behåll dess innebörd och id.',
    'Fråga inte om färger, sidantal, ramverk, teknik eller arkitektur. Kunden får svara "vet inte" och återkomma senare.',
    'Lova ingenting om leverans, pris, tid eller resultat. Ingen HTML, inga länkar, inga listor i frågetexten.',
    'Använd typ "val" bara när svaret naturligt är ett av få alternativ (då 2–5 korta alternativ), annars "oppen".',
    'bild = högst tio korta punkter om vad kunden faktiskt har uppgett (nyckel ur kandidaternas eller de kända uppgifternas',
    'nycklar); gissa inte, fyll inte i sådant kunden inte sagt, och ändra aldrig kundens uppgifter.',
    'Följdfrågor (märkta följd) går före nya områden. Prioritet 1 går före 2 och 3.',
    'klar=true bara när inga följdfrågor eller prioritet 1-luckor återstår och underlaget räcker för nästa arbetssteg.',
    'meddelande = en kort vänlig mening som visar att du förstått, utan värdeord och utan löften.',
  ].join(' ');
}

export function anvandarText(i: LedarIndata): string {
  const rader: string[] = [];
  rader.push('KUND: ' + i.kund.namn);
  rader.push('');
  rader.push('KÄNDA UPPGIFTER (nyckel: värde [källa]):');
  if (i.kanda.length === 0) rader.push('- inga');
  for (const k of i.kanda) rader.push(`- ${k.nyckel}: ${k.varde} [${k.kalla}]`);
  rader.push('');
  rader.push('SAMTALET HITTILLS (fråge-id, fråga, kundens svar ordagrant):');
  if (i.dialog.length === 0) rader.push('- inget ännu');
  for (const d of i.dialog) rader.push(`- ${d.fraga_id} | ${d.fraga} | ${d.svar}`);
  rader.push('');
  rader.push('SENASTE SVAR: ' + (i.senaste ? `${i.senaste.fraga_id} | ${i.senaste.svar}` : 'inget'));
  rader.push('MATERIAL LÄMNAT: ' + i.material + ' st');
  rader.push('');
  rader.push('KANDIDATER (id | prio | följd | nyckel | fråga | vad svaret påverkar):');
  for (const k of i.kandidater)
    rader.push(`- ${k.id} | ${k.prio} | ${k.foljd ? 'följd' + (k.utlost_av ? ' (' + k.utlost_av + ')' : '') : 'ny'}${k.senare ? ' | kunden bad att få återkomma' : ''} | ${k.nyckel} | ${k.text} | ${k.paverkar}`);
  return rader.join('\n');
}

function rensa(s: string, max: number): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, max);
}

/** Validerar modellens svar mot kandidaterna; returnerar null när det inte går att använda. */
export function validera(rå: unknown, i: LedarIndata): LedarUtdata | null {
  const p = Utdata.safeParse(rå);
  if (!p.success) return null;
  const kand = new Map(i.kandidater.map((k) => [k.id, k]));
  const kandaNycklar = new Set([...i.kanda.map((k) => k.nyckel), ...i.kandidater.map((k) => k.nyckel)]);
  const tackta = p.data.tackta
    .filter((t) => kand.has(t.fraga_id) && t.varde.trim())
    .map((t) => ({ fraga_id: t.fraga_id, nyckel: kand.get(t.fraga_id)!.nyckel, varde: rensa(t.varde, MAX_VARDE) }))
    .filter((t, ix, arr) => arr.findIndex((x) => x.fraga_id === t.fraga_id) === ix);
  const tacktIds = new Set(tackta.map((t) => t.fraga_id));
  const valda = p.data.valda
    .filter((v) => kand.has(v.id) && !tacktIds.has(v.id))
    .filter((v, ix, arr) => arr.findIndex((x) => x.id === v.id) === ix)
    .slice(0, 2)
    .map((v) => {
      const text = rensa(v.text, MAX_TEXT) || kand.get(v.id)!.text;
      const alternativ = v.typ === 'val' ? v.alternativ.map((a) => rensa(a, 60)).filter(Boolean).slice(0, 5) : [];
      return { id: v.id, text, typ: alternativ.length >= 2 ? ('val' as const) : ('oppen' as const), alternativ };
    });
  const bild = p.data.bild
    .filter((b) => kandaNycklar.has(b.nyckel) && b.varde.trim())
    .map((b) => ({ nyckel: b.nyckel, varde: rensa(b.varde, MAX_VARDE) }))
    .filter((b, ix, arr) => arr.findIndex((x) => x.nyckel === b.nyckel) === ix)
    .slice(0, 12);
  const kvar = i.kandidater.filter((k) => !tacktIds.has(k.id));
  const maste = kvar.some((k) => k.foljd || k.prio === 1);
  const klar = p.data.klar && !maste;
  if (!klar && valda.length === 0) {
    if (kvar.length === 0) return { valda: [], tackta, bild, meddelande: rensa(p.data.meddelande, MAX_MEDDELANDE), klar: true };
    return null;
  }
  return { valda: klar ? [] : valda, tackta, bild, meddelande: rensa(p.data.meddelande, MAX_MEDDELANDE), klar };
}

/** Den regelstyrda vägen: följdfrågor först, sedan luckor i prioritetsordning, en fråga i taget. */
export function regelstyrd(i: LedarIndata): LedarUtdata {
  const k = i.kandidater[0];
  if (!k) return { valda: [], tackta: [], bild: [], meddelande: '', klar: true };
  return { valda: [{ id: k.id, text: k.text, typ: 'oppen', alternativ: [] }], tackta: [], bild: [], meddelande: '', klar: false };
}

async function gatewayNyckel(): Promise<string | null> {
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY;
  try {
    const { getVercelOidcToken } = await import('@vercel/oidc');
    return await getVercelOidcToken();
  } catch {
    return process.env.VERCEL_OIDC_TOKEN || null;
  }
}

async function viaGateway(i: LedarIndata, modell: string): Promise<{ rå: unknown; tokens_in: number; tokens_out: number }> {
  const nyckel = await gatewayNyckel();
  if (!nyckel) throw new Error('ingen gateway-åtkomst (AI_GATEWAY_API_KEY eller OIDC saknas)');
  const styr = new AbortController();
  const t = setTimeout(() => styr.abort(), 30_000);
  try {
    if (modell.startsWith('anthropic/')) {
      const r = await fetch(GATEWAY + '/v1/messages', {
        method: 'POST',
        signal: styr.signal,
        headers: { Authorization: 'Bearer ' + nyckel, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: modell,
          max_tokens: 1200,
          system: systemText(),
          messages: [{ role: 'user', content: anvandarText(i) }],
          tools: [{ name: 'valj_nasta', description: 'Nästa steg i intervjun.', input_schema: JSON_SCHEMA }],
          tool_choice: { type: 'tool', name: 'valj_nasta' },
        }),
      });
      const d = (await r.json()) as { content?: { type: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
      if (!r.ok) throw new Error(`gateway ${r.status}: ${d.error?.message || 'okänt fel'}`);
      const verktyg = d.content?.find((c) => c.type === 'tool_use');
      return { rå: verktyg?.input, tokens_in: d.usage?.input_tokens ?? 0, tokens_out: d.usage?.output_tokens ?? 0 };
    }
    const kropp: Record<string, unknown> = {
      model: modell,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: systemText() },
        { role: 'user', content: anvandarText(i) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'valj_nasta', strict: true, schema: JSON_SCHEMA } },
    };
    if (/gpt-5/.test(modell)) kropp.reasoning_effort = 'low';
    const r = await fetch(GATEWAY + '/v1/chat/completions', {
      method: 'POST',
      signal: styr.signal,
      headers: { Authorization: 'Bearer ' + nyckel, 'Content-Type': 'application/json' },
      body: JSON.stringify(kropp),
    });
    const d = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
    if (!r.ok) throw new Error(`gateway ${r.status}: ${d.error?.message || 'okänt fel'}`);
    const text = d.choices?.[0]?.message?.content;
    return { rå: text ? JSON.parse(text) : null, tokens_in: d.usage?.prompt_tokens ?? 0, tokens_out: d.usage?.completion_tokens ?? 0 };
  } finally {
    clearTimeout(t);
  }
}

/** Lokal verifiering i byggmiljön: claude -p med JSON-schema, ren miljö, inga verktyg. Aldrig på Vercel. */
async function viaClaudeCli(i: LedarIndata, modell: string): Promise<{ rå: unknown; tokens_in: number; tokens_out: number }> {
  if (process.env.VERCEL) throw new Error('claude-cli är bara för lokal verifiering');
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) continue;
    env[k] = v;
  }
  const prompt = 'SYSTEM:\n' + systemText() + '\n\n' + anvandarText(i);
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(JSON_SCHEMA), '--setting-sources', 'user', '--tools', '', '--max-turns', '1'];
  if (modell && !modell.includes('/')) args.push('--model', modell);
  return await new Promise((resolve, reject) => {
    const p = spawn('claude', args, { env, stdio: 'pipe' });
    let ut = '';
    let fel = '';
    const t = setTimeout(() => {
      p.kill('SIGTERM');
      reject(new Error('claude-cli: tidsgräns'));
    }, 180_000);
    p.stdout.on('data', (d: Buffer) => (ut += d.toString()));
    p.stderr.on('data', (d: Buffer) => (fel += d.toString()));
    p.on('error', (e: Error) => {
      clearTimeout(t);
      reject(e);
    });
    p.on('close', (kod: number | null) => {
      clearTimeout(t);
      if (kod !== 0) return reject(new Error('claude-cli rc ' + kod + ': ' + fel.slice(0, 300)));
      try {
        const d = JSON.parse(ut) as { structured_output?: unknown; result?: string; usage?: { input_tokens?: number; output_tokens?: number } };
        const rå = d.structured_output ?? (d.result ? JSON.parse(d.result) : null);
        resolve({ rå, tokens_in: d.usage?.input_tokens ?? 0, tokens_out: d.usage?.output_tokens ?? 0 });
      } catch (e) {
        reject(new Error('claude-cli: oläsbart svar: ' + (e as Error).message));
      }
    });
    p.stdin.end(prompt);
  });
}

export async function ledNasta(i: LedarIndata, lage: AiLage, modell: string): Promise<LedarResultat> {
  const start = Date.now();
  if (lage === 'regelstyrd' || i.kandidater.length === 0) {
    return { utdata: regelstyrd(i), lage: 'regelstyrd', tokens_in: 0, tokens_out: 0, ms: Date.now() - start, fallback: false };
  }
  try {
    const r = lage === 'gateway' ? await viaGateway(i, modell) : await viaClaudeCli(i, modell);
    const utdata = validera(r.rå, i);
    if (!utdata) {
      return { utdata: regelstyrd(i), lage: 'regelstyrd', modell, tokens_in: r.tokens_in, tokens_out: r.tokens_out, fel: 'ogiltigt modellsvar', ms: Date.now() - start, fallback: true };
    }
    return { utdata, lage, modell, tokens_in: r.tokens_in, tokens_out: r.tokens_out, ms: Date.now() - start, fallback: false };
  } catch (e) {
    const fel = (e as Error).message.slice(0, 200);
    return { utdata: regelstyrd(i), lage: 'regelstyrd', modell, tokens_in: 0, tokens_out: 0, fel, ms: Date.now() - start, fallback: true };
  }
}
