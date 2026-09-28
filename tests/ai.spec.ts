import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { aktuellFraga, internHuvud, oppna, skapaArende, svara, vantaPaNyFraga, visaUppdrag } from './hjalp';

// Körs bara med en verklig modell: KUNDSTART_AI=gateway (AI Gateway, driftläget på Vercel) eller claude-cli (lokalt
// testläge på ägarens Claude Code-inloggning). En märkt testdialog, ingen kund. Provet kräver bara det som inte beror
// på modellens ordval: att agenten faktiskt valt nästa fråga, att dess noteringar har verifierade källor och att
// översikten och exporten visar samma ärende.
const LAGE = process.env.KUNDSTART_AI || 'regelstyrd';
const evidens = process.env.KUNDSTART_EVIDENS;
test.skip(LAGE === 'regelstyrd', 'kräver KUNDSTART_AI=gateway eller claude-cli');
test.setTimeout(300_000);

type Export = {
  ai: { lage: string; anrop: number; modell?: string; kostnad_usd?: number; tokens_in: number; tokens_out: number; senaste_ms?: number };
  omgangar: { fragor: { id: string; valjare: string; kalla: string; inledning?: string }[] }[];
  kunduppgifter: { nyckel: string; citat: string; kalla_id: string }[];
  svar: { fraga_id: string; text: string }[];
  tillval: { id: string; kundval: string | null; kalla?: string; citat?: string; rekommendation?: { text: string } | null; kontroll?: { doman: string } | null }[];
  tackning_agent: { nyckel: string; lage: string }[];
  research: { fraga: string }[];
  handelser: { typ: string; detaljer?: Record<string, unknown> }[];
};

test(`verklig agenttur (${LAGE}): egen följdfråga, noteringar med källa, samma ärende i översikten`, async ({ page, request, baseURL }, info) => {
  const bas = baseURL!;
  const a = await skapaArende(request, bas, 'Testcykel AI ' + LAGE, [], { ai: LAGE });
  await oppna(page, a.lank);
  const f1 = await aktuellFraga(page);
  const svar1 = 'Vi är en liten cykelverkstad i Umeå med två mekaniker. Vi vill att kunderna ska kunna boka service själva på nätet i stället för att ringa, och helst betala en deposition så att folk inte uteblir. Vi har domänen vercel.com. Föreningar som kommer med femton cyklar vill ha en offert först. Vi vet inte riktigt vad vi har för statistik.';
  const t0 = Date.now();
  await svara(page, svar1);
  const f2 = await vantaPaNyFraga(page, f1);
  const ms = Date.now() - t0;
  expect(f2.length).toBeGreaterThan(10);
  await expect(page.locator('.aktuell .inledning-text').first()).toBeVisible();
  const ex = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as Export;
  const fragor = ex.omgangar.flatMap((o) => o.fragor);
  const ag2 = fragor.find((f) => f.id === 'AG2');
  expect(ag2, 'agenten ställde en egen fråga med serverns id').toBeTruthy();
  expect(ag2!.valjare).toBe('ai'); expect(ag2!.kalla).toBe('agent'); expect((ag2!.inledning || '').length).toBeGreaterThan(10);
  expect(ex.ai.anrop).toBeGreaterThanOrEqual(1);
  if (LAGE === 'gateway') expect(ex.ai.kostnad_usd || 0, 'gatewayens faktiska kostnad bokförs').toBeGreaterThan(0);
  for (const u of ex.kunduppgifter) expect(svar1.includes(u.citat), 'kunduppgiftens citat står ordagrant i kundens svar: ' + u.citat).toBe(true);
  for (const t of ex.tillval.filter((x) => x.kalla === 'samtal')) expect(svar1.includes(t.citat || '∅'), 'tillvalets citat är kundens ord').toBe(true);
  const noteringar = ex.kunduppgifter.length + ex.tillval.filter((t) => t.kundval || t.rekommendation).length + ex.tackning_agent.length + ex.research.length;
  expect(noteringar, 'agenten noterade något ur ett svar med flera behov').toBeGreaterThan(0);
  const uppdrag = await visaUppdrag(page);
  if (ex.tillval.some((x) => x.kundval && x.kundval !== 'inte_nu')) await expect(uppdrag.locator('#avsnitt-tillval .tillval-kort.valt').first()).toBeVisible();
  const turer = ex.handelser.filter((h) => h.typ === 'nasta').map((h) => h.detaljer);
  console.log('AI-prov:', JSON.stringify({ lage: LAGE, modell: ex.ai.modell, anrop: ex.ai.anrop, kostnad_usd: ex.ai.kostnad_usd, tokens: [ex.ai.tokens_in, ex.ai.tokens_out], sidans_vantan_ms: ms, fraga: f2, noteringar, tillval: ex.tillval.filter((t) => t.kundval).map((t) => t.id + ':' + t.kundval), turer }));
  if (evidens) {
    writeFileSync(`${evidens}/AI-${LAGE}-${info.project.name}.json`, JSON.stringify({ tid: new Date().toISOString(), arende_id: a.arende_id, sidans_vantan_ms: ms, fraga1: f1, svar1, fraga2: f2, export: ex, omfattning: 'Märkt testdialog mot verklig modell i angivet läge; inget kundsamtal.' }, null, 2));
    await page.screenshot({ path: `${evidens}/AI-${LAGE}-${info.project.name}.png`, fullPage: true });
  }
});
