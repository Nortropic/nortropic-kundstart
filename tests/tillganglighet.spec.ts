import { expect, test } from '@playwright/test';
import { aktuellFraga, oppna, skapaArende } from './hjalp';

test('tangentbord, fokus, zoom och statusåterkoppling', async ({ page, request, baseURL }) => {
  const a = await skapaArende(request, baseURL!, 'Testfirma Tillgänglighet');
  await oppna(page, a.lank);
  await aktuellFraga(page);
  // Ingen zoomspärr; inmatningar minst 16px (ingen iOS-zoom)
  const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1/);
  const fs = await page.locator('textarea.svar-falt').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fs).toBeGreaterThanOrEqual(16);
  // Tangentbord: tabba till fältet, skriv, tabba till Spara och tryck Enter
  await page.locator('textarea.svar-falt').first().focus();
  await page.keyboard.type('Svar med tangentbordet');
  await expect(page.locator('.status.osparad').first()).toHaveText('Inte sparat än');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Spara svar' }).first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.status.sparat').first()).toContainText('Sparat', { timeout: 20_000 });
  // Statusregionen är aria-live; ny fråga får fokus
  await expect(page.locator('[role=status][aria-live=polite]').first()).toBeAttached();
  await expect(page.locator('h2.fragetext').first()).toBeFocused({ timeout: 60_000 });
  // Flikar går att nå med tangentbord
  await page.getByRole('tab', { name: /Material/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Material' })).toBeVisible();
  // Zoom 200 %: ingen horisontell rullning
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const bredd = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(bredd).toBe(true);
});
