import { expect, test, type Page } from '@playwright/test';
import { aktuellFraga, borja, oppna, skapaArende } from './hjalp';

// Modellvalet finns bara i det lokala testläget (KUNDSTART_AI=claude-cli, som förbättringspartnern). Proven här gör
// inga modellanrop: öppningsfrågan är fast. Den vanliga sviten prövar att valet saknas utanför testläget.
const LAGE = process.env.KUNDSTART_AI || 'regelstyrd';

async function installningar(page: Page, kropp?: object, huvud = true): Promise<{ status: number; data: Record<string, unknown> }> {
  return page.evaluate(async ({ kropp, huvud }) => {
    const r = await fetch('/api/prov/installningar', kropp
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...(huvud ? { 'x-kundstart-prov': '1' } : {}) }, body: JSON.stringify(kropp) }
      : undefined);
    return { status: r.status, data: await r.json().catch(() => ({})) };
  }, { kropp, huvud });
}

test('testläget: modell och ansträngning väljs i skrivrutan och med /model och /effort, som i förbättringspartnern', async ({ page, request, baseURL }) => {
  test.skip(LAGE !== 'claude-cli', 'modellvalet finns bara i det lokala testläget');
  const a = await skapaArende(request, baseURL!, 'Testfirma Modellval', undefined, { ai: 'claude-cli' });
  await oppna(page, a.lank);
  await borja(page);
  await aktuellFraga(page);
  expect((await installningar(page, { modell: 'claude-opus-5-5', anstrangning: 'low' })).status).toBe(200);
  try {
    await page.reload();
    await aktuellFraga(page);

    const knapp = page.getByRole('button', { name: /^Modell och ansträngning:/ });
    await expect(knapp).toHaveText(/Opus 5\.5 · low/);
    await knapp.click();
    const meny = page.getByRole('dialog', { name: 'Modell och ansträngning i testläget' });
    await expect(meny).toBeVisible();
    await expect(meny.getByRole('radio', { name: /Opus 5\.5/ })).toBeFocused();
    await meny.getByRole('radio', { name: /Sonnet 5/ }).check();
    await expect(page.locator('.mv-status')).toHaveText('Sonnet 5 · low gäller från nästa fråga.');
    await meny.getByRole('radio', { name: 'medium' }).check();
    await expect(page.locator('.mv-status')).toHaveText('Sonnet 5 · medium gäller från nästa fråga.');
    await page.keyboard.press('Escape');
    await expect(meny).toBeHidden();
    await expect(knapp).toBeFocused();
    await expect(knapp).toHaveText(/Sonnet 5 · medium/);

    // Kommandona i rutan byter direkt och sparas aldrig som svar.
    const falt = page.locator('textarea.svar-falt').first();
    await falt.fill('/effort high');
    await page.getByRole('button', { name: 'Skicka svar' }).first().click();
    await expect(page.locator('.mv-status')).toHaveText('Sonnet 5 · high gäller från nästa fråga.');
    await expect(falt).toHaveValue('');
    await falt.fill('/model haiku');
    await falt.press('ControlOrMeta+Enter');
    await expect(page.locator('.mv-status')).toHaveText('Haiku 4.5 · high gäller från nästa fråga.');
    await falt.fill('/model gpt');
    await falt.press('ControlOrMeta+Enter');
    await expect(page.locator('.mv-status')).toHaveText(/^Okänd modell: gpt\./);
    await falt.fill('/effort medium');
    await falt.press('ControlOrMeta+Enter');
    await expect(page.locator('.mv-status')).toHaveText('Haiku 4.5 · medium gäller från nästa fråga.');
    await expect(falt).toHaveValue('');
    await expect(page.locator('.logg .kund')).toHaveCount(0);

    const las = await installningar(page);
    expect([las.status, las.data.modell, las.data.anstrangning]).toEqual([200, 'claude-haiku-4-5-20251001', 'medium']);
    expect((las.data.syntes as { modell: string }).modell, 'syntesens eget val följer med').toBeTruthy();
    expect((await installningar(page, { modell: 'claude-opus-5', anstrangning: 'low' }, false)).status, 'utan ytans huvud').toBe(403);
    expect((await installningar(page, { modell: 'openai/gpt-5-mini', anstrangning: 'low' })).status, 'okänd modell').toBe(400);
  } finally {
    // Proven lämnar alltid standardvalet efter sig (andra prov mot samma server kör modellturer).
    await installningar(page, { modell: 'claude-opus-5-5', anstrangning: 'low' });
  }
});

test('utanför testläget finns ingen modellväljare och ingen inställningsväg', async ({ page, request, baseURL }) => {
  test.skip(LAGE === 'claude-cli', 'gäller servrar utan testläget');
  const a = await skapaArende(request, baseURL!, 'Testfirma Ingen Modellväljare');
  await oppna(page, a.lank);
  await borja(page);
  await aktuellFraga(page);
  await expect(page.getByRole('button', { name: /^Modell och ansträngning:/ })).toHaveCount(0);
  expect((await installningar(page)).status).toBe(404);
  expect((await installningar(page, { modell: 'claude-opus-5-5', anstrangning: 'low' })).status).toBe(404);
});
