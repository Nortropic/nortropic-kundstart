import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { INTERN_NYCKEL } from '../playwright.config';

export const FAKTA_TESTDIALOG = [
  { nyckel: 'erbjudande', varde: 'Klippning, färgning och skäggtrimning i salongen på Storgatan (TESTDIALOG)', status: 'kunden uppger', kalla: 'er befintliga webbplats (testunderlag)', omrade: 'A' },
  { nyckel: 'kontaktvagar', varde: 'telefon: 0920-000 000; e-post: hej@exempel.test', status: 'kunden uppger', kalla: 'er befintliga webbplats (testunderlag)', omrade: 'D' },
];

export async function skapaArende(request: APIRequestContext, bas: string, namn: string, fakta = FAKTA_TESTDIALOG, extra: Record<string, unknown> = {}) {
  const r = await request.post(bas + '/api/intern/arenden', {
    headers: { Authorization: 'Bearer ' + INTERN_NYCKEL },
    data: { kund: { slug: namn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), namn }, testdialog: true, kanal: 'Kundstart-länk (TESTDIALOG)', fakta, bas_url: bas, ...extra },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { arende_id: string; lank: string; lank_hash: string; utgar: string; ai: string };
}

export async function oppna(page: Page, lank: string) {
  await page.goto(lank);
  await page.waitForURL(/\/samtal$/);
}

export async function svara(page: Page, text: string) {
  const falt = page.locator('textarea.svar-falt').first();
  await expect(falt).toBeVisible();
  await falt.fill(text);
  await page.getByRole('button', { name: 'Spara svar' }).first().click();
  await expect(page.locator('.status.sparat').first()).toContainText('Sparat', { timeout: 20_000 });
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
  await expect(h).toBeVisible({ timeout: 60_000 });
  return (await h.textContent())?.trim() || '';
}

export async function vantaPaNyFraga(page: Page, forra: string) {
  await expect(page.locator('h2.fragetext').first()).not.toHaveText(forra, { timeout: 60_000 });
  return aktuellFraga(page);
}

export function internHuvud() {
  return { Authorization: 'Bearer ' + INTERN_NYCKEL };
}
