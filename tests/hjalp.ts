import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { INTERN_NYCKEL } from '../playwright.config';

export const FAKTA_TESTDIALOG = [
  { nyckel: 'erbjudande', varde: 'Klippning, färgning och skäggtrimning i salongen på Storgatan (TESTDIALOG)', status: 'kunden uppger', kalla: 'er befintliga webbplats (testunderlag)', omrade: 'A' },
  { nyckel: 'kontaktvagar', varde: 'telefon: 0920-000 000; e-post: hej@exempel.test', status: 'kunden uppger', kalla: 'er befintliga webbplats (testunderlag)', omrade: 'D' },
];

/** Funktionsproven skapar regelstyrda ärenden (deterministiska, inga modellanrop) även mot en server vars standard är
 *  gateway; modellen provas uttryckligen i ai.spec.ts genom `extra.ai`. */
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

/** Visar "Ditt uppdrag": bredvid samtalet på stor skärm, som ark på mobil. Returnerar översiktens behållare. */
export async function visaUppdrag(page: Page): Promise<Locator> {
  const knapp = page.locator('.uppdrag-knapp');
  if (await knapp.isVisible()) {
    await knapp.click();
    await expect(page.locator('dialog.ark')).toBeVisible();
    return page.locator('dialog.ark .uppdrag');
  }
  const aside = page.locator('aside.uppdrag-yta .uppdrag');
  await expect(aside).toBeVisible();
  return aside;
}

/** Stänger arket på mobil (ingen effekt på stor skärm). */
export async function tillbakaTillSamtalet(page: Page) {
  const tillbaka = page.getByRole('button', { name: 'Tillbaka till samtalet' });
  if (await tillbaka.isVisible()) await tillbaka.click();
}

export function internHuvud() {
  return { Authorization: 'Bearer ' + INTERN_NYCKEL };
}
