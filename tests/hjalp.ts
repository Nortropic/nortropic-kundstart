import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { INTERN_NYCKEL } from '../playwright.config';

export const FAKTA_TESTDIALOG = [
  { nyckel: 'erbjudande', varde: 'Klippning, färgning och skäggtrimning i salongen på Storgatan (TESTDIALOG)', status: 'kunden uppger', kalla: 'er befintliga webbplats (testunderlag)', omrade: 'A' },
  { nyckel: 'kontaktvagar', varde: 'telefon: 0920-000 000; e-post: hej@exempel.test', status: 'kunden uppger', kalla: 'er befintliga webbplats (testunderlag)', omrade: 'D' },
];

/** Funktionsproven skapar regelstyrda ärenden (deterministiska, inga modellanrop) även mot en server vars standard är
 *  gateway eller claude-cli; modellen provas uttryckligen i ai.spec.ts genom `extra.ai`. */
export async function skapaArende(request: APIRequestContext, bas: string, namn: string, fakta = FAKTA_TESTDIALOG, extra: Record<string, unknown> = {}) {
  const r = await request.post(bas + '/api/intern/arenden', {
    headers: { Authorization: 'Bearer ' + INTERN_NYCKEL },
    data: { kund: { slug: namn.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), namn }, testdialog: true, kanal: 'Kundstart-länk (TESTDIALOG)', fakta, bas_url: bas, ai: 'regelstyrd', ...extra },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { arende_id: string; lank: string; lank_hash: string; utgar: string; ai: string };
}

export async function oppna(page: Page, lank: string) {
  await page.goto(lank);
  await page.waitForURL(/\/samtal$/);
}

/** Startskärmen: "Börja intervjun" ställer öppningsfrågan. Pågår intervjun redan väntar den bara in frågan. */
export async function borja(page: Page) {
  const knapp = page.getByRole('button', { name: 'Börja intervjun' });
  if (await knapp.count()) await knapp.click();
  await expect(page.locator('h2.fragetext').first()).toBeVisible({ timeout: 30_000 });
}

/** Skickar ett svar på den aktuella frågan och väntar på serverns bekräftelse. */
export async function svara(page: Page, text: string) {
  const falt = page.locator('textarea.svar-falt').first();
  await expect(falt).toBeVisible();
  await falt.fill(text);
  await page.getByRole('button', { name: 'Skicka svar' }).first().click();
  await vantaPaSparat(page, text);
}

/** Loggen byggs ur serverns vy: står svaret där med "Sparat" har servern tagit emot det. */
export async function vantaPaSparat(page: Page, text: string) {
  await expect(page.locator('.logg .kund', { hasText: text.slice(0, 40) }).last()).toContainText('Sparat', { timeout: 20_000 });
}

/** Hämtar som sidan själv (webbläsarens kaka följer med; Playwrights request-API skickar inte en Secure-kaka över http). */
export async function hamtaSomSida(page: Page, url: string): Promise<{ status: number; base64: string; text: string }> {
  return page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'same-origin' });
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (const b of buf) bin += String.fromCharCode(b);
    return { status: r.status, base64: btoa(bin), text: new TextDecoder().decode(buf).slice(0, 300) };
  }, url);
}

export async function aktuellFraga(page: Page): Promise<string> {
  const h = page.locator('h2.fragetext').first();
  await expect(h).toBeVisible({ timeout: 90_000 });
  return (await h.textContent())?.trim() || '';
}

export async function vantaPaNyFraga(page: Page, forra: string) {
  await expect(page.locator('h2.fragetext').first()).not.toHaveText(forra, { timeout: 90_000 });
  return aktuellFraga(page);
}

/** Kunden avslutar intervjun via länken och bekräftelsen; väntar på avslutskortet (intervjuaren kan behöva avrunda). */
export async function avsluta(page: Page) {
  await page.getByRole('button', { name: 'Avsluta intervjun' }).click();
  await page.getByRole('button', { name: 'Ja, avsluta' }).click();
  await expect(page.locator('.aktuell.avslut')).toBeVisible({ timeout: 300_000 });
}

/** Till granskningen: avslutar om intervjun pågår och går vidare till sammanfattningen. Returnerar översikten där. */
export async function tillGranskning(page: Page): Promise<Locator> {
  if ((await page.locator('.granskning').count()) === 0) {
    if ((await page.locator('.aktuell.avslut').count()) === 0) await avsluta(page);
    await page.getByRole('button', { name: /Gå vidare till sammanfattningen|Skicka och gå vidare/ }).click();
  }
  await expect(page.locator('.granskning')).toBeVisible({ timeout: 300_000 });
  const u = page.locator('.granskning .uppdrag');
  await expect(u).toBeVisible();
  return u;
}

/** Öppnar ett infällt avsnitt i översikten ("Tillval (valfritt)", "Material (valfritt)") om det är stängt. */
export async function oppnaAvsnitt(uppdrag: Locator, namn: string) {
  const d = uppdrag.locator('details.avsnitt-infallt', { has: uppdrag.page().locator('summary', { hasText: namn }) });
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator('summary').click();
}

/** Läser igenom (hoppar till slutet), kryssar i samtycket och lämnar in; väntar på tacksidan. */
export async function lasOchLamnaIn(page: Page) {
  await page.getByRole('button', { name: 'Hoppa till slutet av intervjun' }).click();
  const ruta = page.getByRole('checkbox', { name: /Jag har läst igenom min intervju/ });
  await expect(ruta).toBeEnabled();
  await ruta.check();
  await page.getByRole('button', { name: /^Lämna in( ändringarna)?$/ }).click();
  await expect(page.locator('.tack')).toBeVisible({ timeout: 20_000 });
}

/** "Jag vill berätta mer" från avslutet, granskningen eller tacksidan; väntar på en öppen fråga i tråden. */
export async function berattaMer(page: Page) {
  if (await page.locator('.tack').count()) await page.getByRole('button', { name: 'Visa det ni lämnat' }).click();
  await page.getByRole('button', { name: 'Jag vill berätta mer' }).click();
  await expect(page.locator('h2.fragetext').first()).toBeVisible({ timeout: 90_000 });
}

export function internHuvud() {
  return { Authorization: 'Bearer ' + INTERN_NYCKEL };
}
