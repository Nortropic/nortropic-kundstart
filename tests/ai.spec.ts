import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { aktuellFraga, avsluta, borja, internHuvud, lasOchLamnaIn, oppna, skapaArende, svara } from './hjalp';

// Körs bara med en verklig modell: KUNDSTART_AI=claude-cli (lokalt testläge på ägarens Claude Code-inloggning) eller
// gateway (AI Gateway, påslagen uttryckligen). En märkt testdialog, ingen kund. Provet kräver bara det som inte beror
// på modellens ordval: att intervjuaren ställt egna frågor med återkoppling, att avrundningen speglar samtalet, att
// syntesens noteringar och citat har verifierade källor och att exporten visar samma ärende.
// Tips: KUNDSTART_AVSLUT_EFTER_FRAGOR=3 (webServer.env) låter intervjuaren avrunda själv efter tre frågor.
const LAGE = process.env.KUNDSTART_AI || 'regelstyrd';
const evidens = process.env.KUNDSTART_EVIDENS;
test.skip(LAGE === 'regelstyrd', 'kräver KUNDSTART_AI=claude-cli eller gateway');
test.setTimeout(1_200_000);

type Export = {
  fas: string;
  ai: { lage: string; anrop: number; modell?: string; kostnad_usd?: number; tokens_in: number; tokens_out: number; senaste_ms?: number; diagnostik?: Record<string, unknown>[] };
  omgangar: { fragor: { id: string; valjare: string; kalla: string; inledning?: string; roll?: string; text: string }[] }[];
  kunduppgifter: { nyckel: string; citat: string; kalla_id: string }[];
  svar: { fraga_id: string; text: string }[];
  tillval: { id: string; kundval: string | null; kalla?: string; citat?: string; rekommendation?: { text: string } | null }[];
  tackning_agent: { nyckel: string; lage: string }[];
  research: { fraga: string }[];
  syntes: { status: string; valjare: string; modell?: string; sammanfattning: string; nyckelinsikt: string; oppet: { nyckel: string }[]; ms?: number } | null;
  samtal_klar: { valjare: string; meddelande: string } | null;
  arende: { inlamningar: { samtycke?: { version: string } }[] };
  handelser: { typ: string; detaljer?: Record<string, unknown> }[];
};

const SVAR = [
  'Vi är en liten cykelverkstad i Umeå med två mekaniker. Vi vill att kunderna ska kunna boka service själva på nätet i stället för att ringa, och helst betala en deposition så att folk inte uteblir. Vi har domänen vercel.com. Föreningar som kommer med femton cyklar vill ha en offert först. Vi vet inte riktigt vad vi har för statistik.',
  'Mest privatpersoner i Umeå som ringer eller kommer förbi, och på våren blir det kö. Vi vill slippa ringandet och få bokningarna direkt i kalendern.',
  'Vi ringer tillbaka samma dag och bokar in dem. Betalning tar vi i verkstaden med Swish eller kort; kunderna finns i Fortnox.',
];

test(`verklig intervju (${LAGE}): egna frågor med återkoppling, avrundning, syntes med källor, samtycke`, async ({ page, request, baseURL }, info) => {
  const bas = baseURL!;
  const a = await skapaArende(request, bas, 'Testcykel AI ' + LAGE, [], { ai: LAGE });
  const exportera = async () => (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as Export;
  await oppna(page, a.lank);
  await borja(page);
  let forra = await aktuellFraga(page);
  const tider: number[] = [];
  const fragor: string[] = [forra];
  let avrundat = false;
  for (const text of SVAR) {
    const t0 = Date.now();
    await svara(page, text);
    // Nästa fråga eller avslutskortet (avslutskortet har själv en h2.fragetext, därför ingen .or-lokator).
    await expect.poll(async () => {
      if (await page.locator('.aktuell.avslut').count()) return true;
      const h2 = page.locator('h2.fragetext').first();
      if ((await h2.count()) === 0) return false; // nästa fråga hämtas fortfarande
      return ((await h2.textContent()) || '').trim() !== forra;
    }, { timeout: 300_000, intervals: [500, 1_000, 2_000] }).toBe(true);
    tider.push(Date.now() - t0);
    if (await page.locator('.aktuell.avslut').count()) { avrundat = true; break; }
    forra = await aktuellFraga(page);
    fragor.push(forra);
    await expect(page.locator('.aktuell .inledning-text').first(), 'återkoppling före frågan').toBeVisible();
  }
  let ex = await exportera();
  const alla = ex.omgangar.flatMap((o) => o.fragor);
  const egna = alla.filter((f) => f.valjare === 'ai' && f.roll !== 'avslut');
  expect(egna.length, 'intervjuaren ställde egna frågor med serverns id').toBeGreaterThanOrEqual(1);
  for (const f of egna) {
    expect(f.kalla).toBe('agent'); expect((f.inledning || '').length, 'återkoppling: ' + f.id).toBeGreaterThan(10);
    expect(f.text.split(/[.!?]\s/).length, 'högst två meningar: ' + f.text).toBeLessThanOrEqual(3);
    expect(f.text, 'inga listmarkörer').not.toMatch(/^\s*[-•*]/m);
  }
  expect(ex.kunduppgifter.length + ex.tillval.length, 'inga noteringar under intervjun').toBe(0);
  if (!avrundat && !(await page.locator('.aktuell.avslut').count())) {
    const t0 = Date.now();
    await avsluta(page);
    tider.push(Date.now() - t0);
  }
  ex = await exportera();
  expect(ex.fas).toBe('avslut');
  expect(ex.samtal_klar?.valjare, 'intervjuaren avrundade').toBe('ai');
  expect((ex.samtal_klar?.meddelande || '').length, 'avrundningen speglar samtalet').toBeGreaterThan(20);
  await expect(page.locator('.aktuell.avslut .inledning-text')).toBeVisible();
  await page.locator('.aktuell.avslut textarea.svar-falt').fill('Nej, det var allt. Tack!');
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Skicka och gå vidare' }).click();
  await expect(page.locator('.granskning')).toBeVisible({ timeout: 600_000 });
  const syntesMs = Date.now() - t1;
  ex = await exportera();
  expect(ex.fas).toBe('granskning');
  expect(ex.syntes?.status).toBe('klar');
  expect(ex.syntes?.valjare, 'sammanfattningen är skriven av modellen, inte reserven').toBe('ai');
  expect((ex.syntes?.sammanfattning || '').length).toBeGreaterThan(50);
  expect(ex.syntes?.sammanfattning, 'inga listor i sammanfattningen').not.toMatch(/^\s*[-•*]/m);
  const allaSvar = ex.svar.map((s) => s.text).join('\n');
  for (const u of ex.kunduppgifter) expect(allaSvar.includes(u.citat), 'kunduppgiftens citat står ordagrant i kundens svar: ' + u.citat).toBe(true);
  for (const t of ex.tillval.filter((x) => x.kalla === 'samtal')) expect(allaSvar.includes(t.citat || '∅'), 'tillvalets citat är kundens ord: ' + t.id).toBe(true);
  for (const m of (ex.syntes?.sammanfattning || '').matchAll(/”([^”]{12,})”/g)) expect(allaSvar.includes(m[1]), 'citat i sammanfattningen är ordagrant: ' + m[1]).toBe(true);
  const noteringar = ex.kunduppgifter.length + ex.tillval.filter((t) => t.kundval || t.rekommendation).length + ex.tackning_agent.length + ex.research.length;
  expect(noteringar, 'syntesen noterade något ur svar med flera behov').toBeGreaterThan(0);
  await expect(page.locator('.syntes-kalla')).toContainText('Skriven av AI-stödet');
  await lasOchLamnaIn(page);
  ex = await exportera();
  expect(ex.fas).toBe('inlamnat');
  expect(ex.arende.inlamningar[0].samtycke?.version).toBe('samtycke/1');
  const turer = ex.handelser.filter((h) => h.typ === 'nasta' || h.typ === 'syntes').map((h) => h.detaljer);
  const cache = (ex.ai.diagnostik || []).map((d) => d.cache_read);
  console.log('AI-prov:', JSON.stringify({ lage: LAGE, modell: ex.ai.modell, syntes_modell: ex.syntes?.modell, anrop: ex.ai.anrop, tokens: [ex.ai.tokens_in, ex.ai.tokens_out], sidans_vantan_ms: tider, syntes_ms: syntesMs, fragor, noteringar, cache_read_senaste: cache, tillval: ex.tillval.filter((t) => t.kundval).map((t) => t.id + ':' + t.kundval), oppet: ex.syntes?.oppet.map((o) => o.nyckel), turer }));
  if (evidens) {
    writeFileSync(`${evidens}/AI-${LAGE}-${info.project.name}.json`, JSON.stringify({ tid: new Date().toISOString(), arende_id: a.arende_id, sidans_vantan_ms: tider, syntes_ms: syntesMs, fragor, svar: SVAR, export: ex, omfattning: 'Märkt testdialog mot verklig modell i angivet läge; inget kundsamtal.' }, null, 2));
    await page.screenshot({ path: `${evidens}/AI-${LAGE}-${info.project.name}.png`, fullPage: true });
  }
});
