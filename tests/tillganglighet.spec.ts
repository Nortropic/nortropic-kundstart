import { expect, test } from '@playwright/test';
import { aktuellFraga, oppna, oppnaAvsnitt, skapaArende, tillGranskning, vantaPaSparat } from './hjalp';

test('tangentbord, fokus, zoom, samtycket med tangentbord och statusåterkoppling', async ({ page, request, baseURL }) => {
  const a = await skapaArende(request, baseURL!, 'Testfirma Tillgänglighet');
  await oppna(page, a.lank);
  await page.getByRole('button', { name: 'Börja intervjun' }).focus();
  await page.keyboard.press('Enter');
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const bredd = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(bredd).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
  // Granskningen med tangentbord: kryssrutan är låst tills slutet nåtts; "Hoppa till slutet" låser upp; Lämna in sist.
  const uppdrag = await tillGranskning(page);
  const ruta = page.getByRole('checkbox', { name: /Jag har läst igenom min intervju/ });
  const lamnaIn = page.getByRole('button', { name: 'Lämna in', exact: true });
  await expect(lamnaIn).toBeDisabled();
  await page.getByRole('button', { name: 'Hoppa till slutet av intervjun' }).focus();
  await page.keyboard.press('Enter');
  await expect(ruta).toBeEnabled();
  await ruta.focus();
  await page.keyboard.press('Space');
  await expect(ruta).toBeChecked();
  await expect(lamnaIn).toBeEnabled();
  // Samma reflow i översikten med domänfältet öppet (längsta knapptexten i en rad med fält).
  await oppnaAvsnitt(uppdrag, 'Tillval (valfritt)');
  await uppdrag.locator('summary', { hasText: 'Alla möjligheter' }).click();
  const doman = uppdrag.locator('.tillval-kort', { has: page.locator('.tv-namn', { hasText: 'Egen domän' }) });
  await doman.getByRole('button', { name: 'Vi har redan en domän' }).click();
  await expect(doman.getByRole('button', { name: 'Kontrollera och spara' })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const ingenSidrullning = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(ingenSidrullning, 'ingen horisontell rullning med domänfältet öppet vid 200 %').toBe(true);
});
