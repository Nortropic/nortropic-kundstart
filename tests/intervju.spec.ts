import { expect, test } from '@playwright/test';
import { aktuellFraga, avsluta, berattaMer, borja, internHuvud, lasOchLamnaIn, oppna, skapaArende, svara, tillGranskning, vantaPaNyFraga } from './hjalp';

// Intervjuformatet i det modellfria läget (standardlistan): startskärm, en tråd utan paneler, kundens eget avslut,
// sista tankar, granskning med sammanfattning och samtycke, tacksida, och vägen tillbaka ("berätta mer").
type Export = { fas: string; syntes: { id: string; status: string; valjare: string; sammanfattning: string } | null; transkript: { roll: string; svar: { text: string } | null }[]; svar: { fraga_id: string; text: string }[]; omgangar: { fragor: { id: string; roll?: string }[] }[]; arende: { inlamningar: { samtycke?: { version: string; text: string } }[] } };

test('startskärm, intervju, avslut, granskning med samtycke, tack och berätta mer', async ({ page, request, baseURL }) => {
  const bas = baseURL!;
  const a = await skapaArende(request, bas, 'Testfirma Intervju');
  const exportera = async () => (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as Export;
  await oppna(page, a.lank);

  // Startskärmen: ingen fråga, två rader, två knappar. "Inte nu" sparar ingenting.
  await expect(page.getByRole('heading', { name: 'Berätta om er verksamhet, så bygger vi rätt webbplats' })).toBeVisible();
  await expect(page.getByText('Räkna med ungefär 15 minuter')).toBeVisible();
  await expect(page.getByText('bestämmer själva om den ska lämnas vidare')).toBeVisible();
  await expect(page.locator('h2.fragetext')).toHaveCount(0);
  await page.getByRole('button', { name: 'Inte nu' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ingenting har sparats än' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Börja intervjun' })).toBeVisible();
  expect((await exportera()).fas).toBe('intro');

  // Intervjun: öppningsfrågan med intervjuarens inledning; bara tråden och skrivrutan.
  await borja(page);
  const f1 = await aktuellFraga(page);
  expect(f1).toContain('Berätta med egna ord');
  await expect(page.locator('.aktuell .inledning-text')).toHaveText('Tack för att ni tar er tid. Vi börjar med det viktigaste.');
  for (const sel of ['.uppdrag', 'aside', 'dialog', '.alternativ', '.piller:not(.modellrad)']) await expect(page.locator(sel), sel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vet inte' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fler sätt att svara' })).toHaveCount(0);
  await svara(page, 'Vi är en liten salong och vill att fler ska hitta oss och boka tid.');
  await expect(page.locator('.logg .kund').first()).toContainText('fler ska hitta oss');
  const f2 = await vantaPaNyFraga(page, f1);
  await expect(page.locator('.framsteg')).toContainText('Fråga 2 av ungefär');
  await page.reload();
  await expect(page.locator('h2.fragetext').first()).toHaveText(f2);
  await expect(page.locator('.logg li')).toHaveCount(1);

  // Kundens eget avslut: bekräftelse, avslutskort med fast text och avslutsfråga; sista tankar sparas.
  await avsluta(page);
  await expect(page.locator('.aktuell.avslut .inledning-text')).toContainText('Ni har svarat på 1 fråga');
  await expect(page.locator('.aktuell.avslut h2.fragetext')).toHaveText('Är det något mer ni vill ta upp innan vi går vidare?');
  await expect(page.getByRole('button', { name: 'Gå vidare till sammanfattningen' })).toBeVisible();
  await page.locator('.aktuell.avslut textarea.svar-falt').fill('Nej, det var allt för nu.');
  await expect(page.getByRole('button', { name: 'Skicka och gå vidare' })).toBeVisible();
  await page.getByRole('button', { name: 'Skicka och gå vidare' }).click();

  // Granskningen: sammanfattningen ur kundens ord, översikten, hela intervjun, kryssrutan låst tills slutet nåtts.
  await expect(page.locator('.granskning')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Läs igenom innan ni lämnar in' })).toBeVisible();
  await expect(page.locator('.syntes-text').first()).toContainText('Det ni berättat, i era egna ord');
  await expect(page.locator('.syntes')).toContainText('”Vi är en liten salong och vill att fler ska hitta oss och boka tid.”');
  await expect(page.locator('.syntes')).toContainText('Ert tillägg: ”Nej, det var allt för nu.”');
  await expect(page.locator('.granskning .uppdrag')).toBeVisible();
  // Hela intervjun: öppningsfrågan med svar, frågan som stod öppen när kunden avslutade (uppskjuten), avslutsfrågan med tillägget.
  await expect(page.locator('.transkript .tur')).toHaveCount(3);
  await expect(page.locator('.transkript .tur').nth(1)).toContainText('inte besvarad');
  await expect(page.locator('.transkript .tur').last()).toContainText('Nej, det var allt för nu.');
  const ruta = page.getByRole('checkbox', { name: /Jag har läst igenom min intervju/ });
  const lamnaIn = page.getByRole('button', { name: 'Lämna in', exact: true });
  const slutSyns = await page.locator('.transkript-slut').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; });
  if (!slutSyns) {
    await expect(ruta).toBeDisabled();
    await expect(page.locator('#samtycke-hint')).toHaveText('Rulla igenom hela intervjun ovan först.');
  }
  await expect(lamnaIn).toBeDisabled();
  await page.locator('.transkript-slut').scrollIntoViewIfNeeded();
  await expect(ruta).toBeEnabled();
  await expect(lamnaIn).toBeDisabled();
  await ruta.check();
  await expect(lamnaIn).toBeEnabled();
  let ex = await exportera();
  expect(ex.fas).toBe('granskning');
  expect(ex.syntes?.status).toBe('klar'); expect(ex.syntes?.valjare).toBe('regelstyrd');
  expect(ex.transkript.map((r) => r.roll)).toEqual(['oppning', 'fraga', 'avslut']);
  expect(ex.svar.some((s) => s.text === 'Nej, det var allt för nu.' && ex.omgangar.flatMap((o) => o.fragor).find((f) => f.id === s.fraga_id)?.roll === 'avslut')).toBe(true);

  // Inlämningen med samtycket; tacksidan; det inlämnade kan visas igen.
  await lamnaIn.click();
  await expect(page.locator('.tack')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Tack, Testfirma Intervju/ })).toBeVisible();
  await expect(page.getByText('2 svar i samtalet')).toBeVisible();
  await expect(page.getByText('inte ett godkännande av en design')).toBeVisible();
  ex = await exportera();
  expect(ex.fas).toBe('inlamnat');
  expect(ex.arende.inlamningar[0].samtycke?.version).toBe('samtycke/1');
  expect(ex.arende.inlamningar[0].samtycke?.text).toBe('Jag har läst igenom min intervju och vill lämna den vidare till Nortropic.');
  const syntesId = ex.syntes!.id;

  // "Berätta mer": samtalet öppnas igen, ett nytt svar gör sammanfattningen inaktuell; "Uppdatera" ger en ny.
  await berattaMer(page);
  await svara(page, 'Vi har också öppet på lördagar under våren.');
  const uppdrag = await tillGranskning(page);
  await expect(uppdrag.locator('.uppdrag-status')).toContainText('Ni har ändrat något efter inlämningen');
  await expect(page.locator('.syntes')).toContainText('öppet på lördagar');
  ex = await exportera();
  expect(ex.syntes!.id).not.toBe(syntesId);
  expect(ex.syntes!.status).toBe('klar');
  await lasOchLamnaIn(page);
  expect((await exportera()).arende.inlamningar.length).toBe(2);
});

test('rättelse i granskningen gör sammanfattningen inaktuell; "Uppdatera sammanfattningen" skriver om den', async ({ page, request, baseURL }) => {
  const bas = baseURL!;
  const a = await skapaArende(request, bas, 'Testfirma Uppdatera');
  await oppna(page, a.lank);
  await borja(page);
  await svara(page, 'Vi vill få fler förfrågningar om trädgårdsskötsel.');
  const uppdrag = await tillGranskning(page);
  const ex1 = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as Export;
  await expect(page.locator('.syntes-inaktuell')).toHaveCount(0);
  const erb = uppdrag.locator('.bild-rad', { hasText: 'Vad ni erbjuder' });
  await erb.getByRole('button', { name: /Ändra/ }).click();
  await erb.locator('textarea.ratt-falt').fill('Klippning och färgning.');
  await erb.getByRole('button', { name: 'Spara rättelse' }).click();
  await expect(erb.locator('.varde')).toHaveText('Klippning och färgning.');
  await expect(page.locator('.syntes-inaktuell')).toContainText('Ni har ändrat något efter att sammanfattningen skrevs');
  await page.getByRole('button', { name: 'Uppdatera sammanfattningen' }).click();
  await expect.poll(async () => ((await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as Export).syntes!.id, { timeout: 60_000 }).not.toBe(ex1.syntes!.id);
  await expect(page.locator('.syntes-inaktuell')).toHaveCount(0);
  await expect(page.locator('.status.vantar')).toHaveCount(0);
  const ex2 = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as Export;
  expect(ex2.syntes!.status).toBe('klar');
});
