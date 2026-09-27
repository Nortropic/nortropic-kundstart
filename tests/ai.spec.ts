import { expect, test } from '@playwright/test';
import { aktuellFraga, internHuvud, oppna, skapaArende, svara, vantaPaNyFraga } from './hjalp';

// Körs bara när servern startats med KUNDSTART_AI=gateway (Vercel AI Gateway) eller claude-cli (lokal verifiering).
// Provet visar att ett verkligt modellanrop påverkar intervjun och syns som sådant i ärendet; en testdialog, ingen kund.
const LAGE = process.env.KUNDSTART_AI || 'regelstyrd';
test.skip(LAGE === 'regelstyrd', 'kräver KUNDSTART_AI=gateway eller claude-cli');

test(`verkligt AI-anrop (${LAGE}) väljer nästa fråga, täcker redan besvarat och syns i exporten`, async ({ page, request, baseURL }) => {
  const bas = baseURL!;
  const a = await skapaArende(request, bas, 'Testfirma AI ' + LAGE, undefined, { ai: LAGE });
  await oppna(page, a.lank);
  const f1 = await aktuellFraga(page);
  // Ett öppet svar som täcker flera områden på en gång (mål, erbjudande, nuläge, senaste förfrågan)
  await svara(page, 'Vi är en liten cykelverkstad i Umeå. Vi vill att folk ska förstå att vi lagar alla sorters cyklar och kunna boka in en reparation via hemsidan, för i dag ringer alla och vi hinner inte svara. Senast i förrgår ringde en kund som ville ha ett däck bytt samma dag och vi tappade bort lappen.');
  const f2 = await vantaPaNyFraga(page, f1);
  expect(f2.length).toBeGreaterThan(10);
  const ex = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as {
    ai: { lage: string; anrop: number; modell?: string; fel: number };
    omgangar: { fragor: { id: string; valjare: string; kalla: string }[] }[];
    fakta_ai: { nyckel: string; status: string; kalla: string }[];
    handelser: { typ: string; detaljer?: { lage?: string; fallback?: boolean; fel?: string; valda?: string[]; tackta?: string[] } }[];
  };
  const nasta = ex.handelser.filter((h) => h.typ === 'nasta');
  expect(ex.ai.anrop, 'modellen anropades').toBeGreaterThanOrEqual(1);
  const lyckade = nasta.filter((h) => h.detaljer?.lage === LAGE && !h.detaljer?.fallback);
  expect(lyckade.length, 'minst ett anrop utan fallback: ' + JSON.stringify(nasta.map((h) => h.detaljer))).toBeGreaterThanOrEqual(1);
  const fragor = ex.omgangar.flatMap((o) => o.fragor);
  expect(fragor.some((f) => f.valjare === 'ai'), 'en fråga valdes av modellen').toBe(true);
  // Modellens tolkningar är egna rader med status tolkning, aldrig kundens ord
  for (const f of ex.fakta_ai) expect(f.status).toBe('tolkning');
  console.log('AI-prov:', JSON.stringify({ lage: ex.ai.lage, modell: ex.ai.modell, anrop: ex.ai.anrop, fel: ex.ai.fel, tackta: nasta.map((h) => h.detaljer?.tackta), valda: nasta.map((h) => h.detaljer?.valda), fakta_ai: ex.fakta_ai.map((x) => x.nyckel) }));
});
