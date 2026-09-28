// Modelltransport för kundsamtalet: Vercel AI Gateway (OIDC på Vercel eller AI_GATEWAY_API_KEY), ett strukturerat
// svar per anrop mot ett strikt JSON-schema, faktisk kostnad ur gatewayens usage.cost. Lokalt kan claude -p användas
// för verifiering i byggmiljön (aldrig på Vercel). Råa provider- eller modelltexter loggas aldrig: de kan innehålla
// kundtext eller åtkomstuppgifter.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

export const GATEWAY = 'https://ai-gateway.vercel.sh';

export class ModellFel extends Error {
  constructor(public klass: string, public retry: boolean, public diagnos: Record<string, unknown> = {}, public tokens_in = 0, public tokens_out = 0, public kostnad_usd: number | null = null) {
    super(klass);
  }
}

export interface ModellSvar {
  rå: unknown;
  tokens_in: number;
  tokens_out: number;
  kostnad_usd: number | null;
  diagnos: Record<string, unknown>;
}

export async function gatewayNyckel(): Promise<string | null> {
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY;
  try {
    const { getVercelOidcToken } = await import('@vercel/oidc');
    return await getVercelOidcToken();
  } catch {
    return process.env.VERCEL_OIDC_TOKEN || null;
  }
}

type GatewayData = {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } };
};

/** Läser ett chat completions-svar: slutorsak, token och faktisk kostnad skiljs åt även vid fel. */
export function lasGatewaySvar(d: GatewayData): ModellSvar {
  const val = d.choices?.[0];
  const inp = d.usage?.prompt_tokens || 0;
  const out = d.usage?.completion_tokens || 0;
  const kostnad = typeof d.usage?.cost === 'number' && Number.isFinite(d.usage.cost) ? d.usage.cost : null;
  const diagnos = { finish_reason: val?.finish_reason || 'saknas', reasoning_tokens: d.usage?.completion_tokens_details?.reasoning_tokens || 0, cached_tokens: d.usage?.prompt_tokens_details?.cached_tokens || 0 };
  if (val?.message?.refusal || val?.finish_reason === 'content_filter') throw new ModellFel('vagran', false, diagnos, inp, out, kostnad);
  if (val?.finish_reason === 'length') throw new ModellFel('avkortat', true, diagnos, inp, out, kostnad);
  if (val?.finish_reason !== 'stop') throw new ModellFel('format', true, diagnos, inp, out, kostnad);
  try {
    return { rå: JSON.parse(val?.message?.content || ''), tokens_in: inp, tokens_out: out, kostnad_usd: kostnad, diagnos };
  } catch {
    throw new ModellFel('format', true, diagnos, inp, out, kostnad);
  }
}

/** Resonemangsnivå för gpt-5-modeller: minimal ger kortast svarstid i ett samtal; low kan väljas med KUNDSTART_AI_RESONEMANG. */
export function resonemang(): 'minimal' | 'low' | 'medium' {
  const v = process.env.KUNDSTART_AI_RESONEMANG;
  return v === 'low' || v === 'medium' ? v : 'minimal';
}

export interface Begaran {
  modell: string;
  system: string;
  anvandare: string;
  schemaNamn: string;
  schema: object;
  maxTokens: number;
  timeoutMs: number;
}

export async function viaGateway(b: Begaran): Promise<ModellSvar> {
  const nyckel = await gatewayNyckel();
  if (!nyckel) throw new ModellFel('atkomst', false);
  const styr = new AbortController();
  const t = setTimeout(() => styr.abort(), b.timeoutMs);
  try {
    const kropp = {
      model: b.modell,
      max_completion_tokens: b.maxTokens,
      ...(/gpt-5/.test(b.modell) ? { reasoning_effort: resonemang() } : {}),
      messages: [{ role: 'system', content: b.system }, { role: 'user', content: b.anvandare }],
      response_format: { type: 'json_schema', json_schema: { name: b.schemaNamn, strict: true, schema: b.schema } },
    };
    const r = await fetch(GATEWAY + '/v1/chat/completions', {
      method: 'POST',
      signal: styr.signal,
      headers: { Authorization: 'Bearer ' + nyckel, 'Content-Type': 'application/json' },
      body: JSON.stringify(kropp),
    });
    if (!r.ok) throw new ModellFel(r.status === 429 ? 'begransad' : r.status >= 500 ? 'transport' : 'atkomst_eller_kontrakt', r.status === 429 || r.status >= 500, { http_status: r.status, retry_after: r.headers.get('retry-after') });
    let d: GatewayData;
    try {
      d = (await r.json()) as GatewayData;
    } catch {
      throw new ModellFel('format', true, { http_status: r.status });
    }
    return lasGatewaySvar(d);
  } catch (e) {
    if (e instanceof ModellFel) throw e;
    throw new ModellFel('transport', true, { avbrutet: styr.signal.aborted });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Lokalt testläge (bara ägarens egna prov på den egna datorn, aldrig på Vercel och aldrig för kunder): varje tur
 * körs med claude -p på ägarens Claude Code-inloggning. Isolerat: egen systemprompt, inga verktyg, inga MCP-servrar,
 * inget automatiskt minne, inga CLAUDE.md-filer och inga sparade sessioner. Inloggningens e-postadress följer ändå med
 * i modellens sammanhang (går inte att stänga av med OAuth) och redovisas som känd begränsning. Förbrukningen räknas i
 * abonnemangets kvot, inte i USD; claude -p:s total_cost_usd är ett listprisvärde och bokförs bara som diagnos.
 */
export async function viaClaudeCli(b: Begaran): Promise<ModellSvar> {
  if (process.env.VERCEL) throw new ModellFel('atkomst', false, { skal: 'claude-cli är bara för lokala prov' });
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'ANTHROPIC_API_KEY' || k.startsWith('KUNDSTART_') || k.startsWith('BLOB_') || k.startsWith('VERCEL')) continue;
    env[k] = v;
  }
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1';
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(b.schema), '--system-prompt', b.system, '--setting-sources', 'user', '--tools', '', '--max-turns', '1', '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config', '--no-session-persistence'];
  if (b.modell && !b.modell.includes('/')) args.push('--model', b.modell);
  // Ett samtal behöver korta svarstider: låg resonemangsnivå som standard (KUNDSTART_CLI_EFFORT kan höja).
  args.push('--effort', ['low', 'medium', 'high'].includes(process.env.KUNDSTART_CLI_EFFORT || '') ? process.env.KUNDSTART_CLI_EFFORT! : 'low');
  const start = Date.now();
  return await new Promise((resolve, reject) => {
    const p = spawn('claude', args, { env, cwd: tmpdir(), stdio: 'pipe' });
    let ut = '';
    const t = setTimeout(() => {
      p.kill('SIGTERM');
      reject(new ModellFel('transport', false, { avbrutet: true }));
    }, Math.min(b.timeoutMs, 170_000));
    p.stdout.on('data', (d: Buffer) => (ut += d.toString()));
    p.on('error', () => {
      clearTimeout(t);
      reject(new ModellFel('atkomst', false, { skal: 'claude-kommandot saknas' }));
    });
    p.on('close', (kod: number | null) => {
      clearTimeout(t);
      if (kod !== 0) return reject(new ModellFel('transport', false, { rc: kod }));
      try {
        const d = JSON.parse(ut) as { structured_output?: unknown; result?: string; is_error?: boolean; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; total_cost_usd?: number };
        if (d.is_error || d.structured_output === undefined) return reject(new ModellFel('format', true, { lage: 'claude-cli' }));
        const u = d.usage || {};
        resolve({ rå: d.structured_output, tokens_in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), tokens_out: u.output_tokens || 0, kostnad_usd: null, diagnos: { lage: 'claude-cli', modell: b.modell, listpris_usd_ej_kostnad: d.total_cost_usd ?? null, ms: Date.now() - start } });
      } catch {
        reject(new ModellFel('format', false));
      }
    });
    p.stdin.end(b.anvandare);
  });
}
