import { expect, test } from '@playwright/test';
import { aktuellFraga, borja, internHuvud, oppna, oppnaAvsnitt, skapaArende, svara, tillGranskning } from './hjalp';

type Export = { tillval: { id: string; kundval: string | null; system?: string; kalla?: string; kontroll?: { doman: string; registrerad: boolean | null } | null; historik: unknown[] }[]; signal?: { id: string } };

test('tillval i granskningens översikt: lägga till, ändra, ångra och eget behov följer med i exporten', async ({ page, request, baseURL }) => {
  const bas = baseURL!;
  const a = await skapaArende(request, bas, 'Testfirma Tillval');
  await oppna(page, a.lank);
  await borja(page);
  await aktuellFraga(page);
  const uppdrag = await tillGranskning(page);
  await oppnaAvsnitt(uppdrag, 'Tillval (valfritt)');
  await expect(uppdrag.getByText('Inga tillval valda ännu.')).toBeVisible();
  await uppdrag.locator('summary', { hasText: 'Alla möjligheter' }).click();
  for (const namn of ['Egen domän', 'Formulär och bilagor', 'E-postmottagning', 'Bokning och kalender', 'Betalning eller deposition', 'Kundregister (CRM)', 'Nyhetsbrev', 'Redigera innehållet själva', 'Google Search Console', 'Google-företagsprofil', 'Google Ads', 'Meta-annonser (Facebook och Instagram)', 'Analys och mätning av förfrågningar']) {
    await expect(uppdrag.locator('.tv-namn', { hasText: namn }).first(), namn).toBeVisible();
  }
  const bokning = uppdrag.locator('.tillval-kort', { has: page.locator('.tv-namn', { hasText: 'Bokning och kalender' }) });
  await bokning.getByRole('button', { name: 'Lägg till' }).click();
  const vald = uppdrag.locator('#avsnitt-tillval .tillval-kort.valt', { has: page.locator('.tv-namn', { hasText: 'Bokning och kalender' }) });
  await expect(vald).toBeVisible();
  await expect(vald.locator('.chip.val')).toHaveText('Ni vill ha detta');
  const crm = uppdrag.locator('.tillval-kort', { has: page.locator('.tv-namn', { hasText: 'Kundregister (CRM)' }) });
  await crm.getByRole('button', { name: 'Vi har redan ett system' }).click();
  await crm.getByLabel('Vilket system använder ni?').fill('Fortnox');
  await crm.getByRole('button', { name: 'Spara' }).click();
  await expect(uppdrag.locator('.tillval-kort.valt', { hasText: 'Fortnox' })).toBeVisible();
  await vald.getByRole('button', { name: 'Ändra' }).click();
  await vald.getByRole('button', { name: 'Inte nu' }).click();
  await expect(uppdrag.locator('#avsnitt-tillval > .tillval-kort.valt', { has: page.locator('.tv-namn', { hasText: 'Bokning och kalender' }) })).toHaveCount(0);
  await uppdrag.getByLabel('Något annat ni behöver? Beskriv med egna ord.').fill('Sälja presentkort');
  await uppdrag.getByRole('button', { name: 'Lägg till' }).last().click();
  await expect(uppdrag.locator('.tillval-kort.valt', { hasText: 'Sälja presentkort' })).toBeVisible();
  await page.reload();
  const igen = await tillGranskning(page);
  await oppnaAvsnitt(igen, 'Tillval (valfritt)');
  await expect(igen.locator('.tillval-kort.valt', { hasText: 'Fortnox' })).toBeVisible();
  const ex = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as Export;
  const t = (id: string) => ex.tillval.find((x) => x.id === id)!;
  expect(t('bokning').kundval).toBe('inte_nu'); expect(t('bokning').historik.length).toBe(2);
  expect(t('crm').kundval).toBe('har_system'); expect(t('crm').system).toBe('Fortnox'); expect(t('crm').kalla).toBe('kontroll');
  expect(t('annat_1').kundval).toBe('onskat');
});

test('domänflödet: befintlig domän kontrolleras i öppna uppgifter och sparas i samma handling', async ({ page, request, baseURL }) => {
  const bas = baseURL!;
  const a = await skapaArende(request, bas, 'Testfirma Domän');
  await oppna(page, a.lank);
  await borja(page);
  await aktuellFraga(page);
  const uppdrag = await tillGranskning(page);
  await oppnaAvsnitt(uppdrag, 'Tillval (valfritt)');
  await uppdrag.locator('summary', { hasText: 'Alla möjligheter' }).click();
  const doman = uppdrag.locator('.tillval-kort', { has: page.locator('.tv-namn', { hasText: 'Egen domän' }) });
  await doman.getByRole('button', { name: 'Vi har redan en domän' }).click();
  await doman.getByLabel('Vilken domän har ni?').fill('https://www.vercel.com/');
  await doman.getByRole('button', { name: 'Kontrollera och spara' }).click();
  const vald = uppdrag.locator('.tillval-kort.valt', { has: page.locator('.tv-namn', { hasText: 'Egen domän' }) });
  await expect(vald).toContainText('Ni har redan en domän: vercel.com', { timeout: 30_000 });
  await expect(vald.locator('.tv-kontroll')).toContainText('vercel.com är registrerad');
  await expect(vald.locator('.tv-kontroll')).toContainText('Ingenting har ändrats hos er leverantör');
  const ex = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as Export;
  const d = ex.tillval.find((x) => x.id === 'doman')!;
  expect(d.kundval).toBe('har_system'); expect(d.kontroll?.doman).toBe('vercel.com'); expect(d.kontroll?.registrerad).toBe(true);
  const intern = await page.evaluate(async () => (await fetch('/api/doman', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doman: 'localhost', kundval: 'har_system', idempotens: 'doman-lokal-001' }) })).status);
  expect(intern, 'interna namn vägras').toBe(400);
});

test('intervjun visar bara tråden och skrivrutan: inga paneler, val, kort eller knappar för att svara på annat sätt', async ({ page, request, baseURL }, info) => {
  const a = await skapaArende(request, baseURL!, 'Testfirma Ren tråd');
  await oppna(page, a.lank);
  await borja(page);
  await svara(page, 'Vi är en cykelverkstad och vill att kunderna bokar service själva.');
  await expect(page.locator('h2.fragetext').first()).toBeVisible();
  for (const sel of ['.uppdrag', 'aside', 'dialog', '.alternativ', '.tillval-kort', '.uppdrag-knapp', '.sidopanel']) await expect(page.locator(sel), sel).toHaveCount(0);
  for (const namn of ['Vet inte', 'Fler sätt att svara', 'Lämna material', 'Välj tillval', 'Ditt uppdrag']) await expect(page.getByRole('button', { name: namn }), namn).toHaveCount(0);
  await expect(page.locator('textarea.svar-falt')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Skicka svar' })).toHaveCount(1);
  await expect(page.locator('.komponera-hint')).toContainText('Vet inte, gäller inte er, eller vill ni återkomma?');
  if (info.project.name === 'mobil') {
    const bredd = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(bredd, 'ingen horisontell rullning på mobil').toBe(true);
  }
});
