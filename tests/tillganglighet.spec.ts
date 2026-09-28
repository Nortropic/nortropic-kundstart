import { expect, test } from '@playwright/test';
import { aktuellFraga, oppna, skapaArende, vantaPaSparat, visaUppdrag } from './hjalp';

test('tangentbord, fokus, zoom och statusåterkoppling', async ({ page, request, baseURL }) => {
  const a = await skapaArende(request, baseURL!, 'Testfirma Tillgänglighet');
  await oppna(page, a.lank);
  await aktuellFraga(page);
  const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1/);
  const fs = await page.locator('textarea.svar-falt').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fs).toBeGreaterThanOrEqual(16);
  await page.locator('textarea.svar-falt').first().focus();
  await page.keyboard.type('Svar med tangentbordet');
  await expect(page.locator('.status.osparad').first()).toHaveText('Inte skickat än');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Skicka svar' }).first()).toBeFocused();
  await page.keyboard.press('Enter');
  await vantaPaSparat(page, 'Svar med tangentbordet');
  await expect(page.locator('[role=status][aria-live=polite]').first()).toBeAttached();
  await expect(page.locator('h2.fragetext').first()).toBeFocused({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Fler sätt att svara' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Återkom senare' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fler sätt att svara' })).toHaveAttribute('aria-expanded', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const bredd = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(bredd).toBe(true);
  // Samma reflow i Ditt uppdrag med domänfältet öppet (längsta knapptexten i en rad med fält).
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
  const uppdrag = await visaUppdrag(page);
  await uppdrag.locator('summary', { hasText: 'Alla möjligheter' }).click();
  const doman = uppdrag.locator('.tillval-kort', { has: page.locator('.tv-namn', { hasText: 'Egen domän' }) });
  await doman.getByRole('button', { name: 'Vi har redan en domän' }).click();
  await expect(doman.getByRole('button', { name: 'Kontrollera och spara' })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const ingenSidrullning = await page.evaluate(() => [document.documentElement, document.querySelector('.ark-inre'), document.querySelector('aside.uppdrag-yta')]
    .filter((el): el is HTMLElement => Boolean(el)).every((el) => el.scrollWidth <= el.clientWidth + 1));
  expect(ingenSidrullning, 'ingen horisontell rullning med domänfältet öppet vid 200 %').toBe(true);
});
