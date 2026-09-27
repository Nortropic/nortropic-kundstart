import { expect, test } from '@playwright/test';
import { aktuellFraga, hamtaSomSida, internHuvud, oppna, skapaArende, svara, vantaPaNyFraga } from './hjalp';

test.describe('Kundstart – två testdialoger, återupptagning, rättelse, material, inlämning', () => {
  test('bokningsbehov ger bokningsfrågor; informationsbehov gör det inte', async ({ page, request, baseURL }) => {
    const bas = baseURL!;
    // Dialog A: TESTDIALOG bokning
    const a = await skapaArende(request, bas, 'Testsalong Bokning');
    await oppna(page, a.lank);
    await expect(page.getByRole('heading', { name: /Hej, Testsalong Bokning/ })).toBeVisible();
    await expect(page.getByText('Det här vet vi redan')).toBeVisible();
    const f1 = await aktuellFraga(page);
    expect(f1.length).toBeGreaterThan(10);
    await svara(page, 'Vi vill att kunder ska kunna boka tid direkt på hemsidan i stället för att ringa. Just nu skriver vi allt i en papperskalender.');
    // Följdfrågor om bokning ska dyka upp inom några frågor
    let hittadBokning = false;
    let forra = f1;
    for (let i = 0; i < 6 && !hittadBokning; i++) {
      const f = await vantaPaNyFraga(page, forra);
      forra = f;
      if (/bok/i.test(f)) {
        hittadBokning = true;
        break;
      }
      await svara(page, 'Vet inte riktigt, det får ni gärna föreslå.');
    }
    expect(hittadBokning, 'ett bokningsbehov ska ge bokningsfrågor').toBe(true);

    // Dialog B: TESTDIALOG ren information
    const b = await skapaArende(request, bas, 'Testbyrå Information');
    await page.context().clearCookies();
    await oppna(page, b.lank);
    const g1 = await aktuellFraga(page);
    // Ett rent informationsbehov som nämner bokning med negation: bankens NEGATION-regel (samma sats, 40 tecken) ska
    // bokföra träffen som negerad i stället för att utlösa bokningsfrågor
    await svara(page, 'Vi vill bara att folk ska hitta våra öppettider och adress och förstå vad vi gör. Inga bokningar via nätet, folk ringer.');
    let forraB = g1;
    for (let i = 0; i < 4; i++) {
      const f = await vantaPaNyFraga(page, forraB);
      forraB = f;
      await svara(page, 'Det är mest privatpersoner i närområdet som hör av sig.');
    }
    const exB = (await (await request.get(`${bas}/api/intern/arenden/${b.arende_id}/export`, { headers: internHuvud() })).json()) as { omgangar: { fragor: { id: string }[] }[]; foljdregler_utlosta: { regel: string }[]; foljdregler_negerade: { regel: string; sats: string }[] };
    expect(exB.foljdregler_utlosta.some((r) => r.regel === 'bokning'), 'ett informationsbehov ska inte utlösa bokningsregeln').toBe(false);
    expect(exB.foljdregler_negerade.some((r) => r.regel === 'bokning'), 'den negerade nämningen bokförs som negerad').toBe(true);
    expect(exB.omgangar.flatMap((o) => o.fragor).some((f) => /^BOK/.test(f.id)), 'inga BOK-följdfrågor för ett informationsbehov').toBe(false);

    // Export: kundens ord ordagrant, kanal, testdialog, inga hemligheter
    const ex = await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() });
    expect(ex.ok()).toBe(true);
    const paket = (await ex.json()) as { schema: string; arende: { testdialog: boolean }; svar: { text: string }[]; omgangar: { svar_md: string }[]; foljdregler_utlosta: { regel: string }[] };
    expect(paket.schema).toBe('kundstart-export/1');
    expect(paket.arende.testdialog).toBe(true);
    expect(paket.svar[0].text).toContain('boka tid direkt på hemsidan');
    expect(paket.omgangar.map((o) => o.svar_md).join('\n')).toMatch(/^### [A-Z]+\d+$/m);
    expect(paket.foljdregler_utlosta.some((r) => r.regel === 'bokning')).toBe(true);
  });

  test('återupptagning efter omladdning, bakåt och ny enhet; dubbelklick och två flikar ger inte dubbla svar', async ({ page, request, baseURL, browser }) => {
    const bas = baseURL!;
    const a = await skapaArende(request, bas, 'Testfirma Återupptagning');
    await oppna(page, a.lank);
    const f1 = await aktuellFraga(page);
    // Skriv utan att spara, ladda om: utkastet finns kvar och är märkt osparat
    await page.locator('textarea.svar-falt').first().fill('Ett svar som inte är sparat än');
    await expect(page.locator('.status.osparad').first()).toHaveText('Inte sparat än');
    await page.reload();
    await expect(page.locator('h2.fragetext').first()).toHaveText(f1);
    await expect(page.locator('textarea.svar-falt').first()).toHaveValue('Ett svar som inte är sparat än');
    // Dubbelklick på Spara: ett svar
    await page.getByRole('button', { name: 'Spara svar' }).first().dblclick();
    await expect(page.locator('.status.sparat').first()).toContainText('Sparat', { timeout: 20_000 });
    const f2 = await vantaPaNyFraga(page, f1);
    const lage1 = await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}`, { headers: internHuvud() })).json();
    expect(lage1.vy.dialog.length).toBe(1);
    // Bakåtknapp och omladdning återställer rätt ärende och aktuell fråga
    await page.goBack().catch(() => undefined);
    await page.goto(bas + '/samtal');
    await expect(page.locator('h2.fragetext').first()).toHaveText(f2);
    await expect(page.locator('.dialog li')).toHaveCount(1);
    // Två flikar: båda svarar på samma fråga; det senare svaret gäller, inget kraschar, inga dubbletter av frågor
    const flik2 = await page.context().newPage();
    await flik2.goto(bas + '/samtal');
    await expect(flik2.locator('h2.fragetext').first()).toHaveText(f2);
    const fragaId2 = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}`, { headers: internHuvud() })).json()).vy.oppna[0].id as string;
    await svara(page, 'Svar från flik ett');
    // Flik två svarar på samma fråga med en annan text: ett ändrat svar, ingen dubblett; samma text igen: ingen ny rad
    await flik2.locator('textarea.svar-falt').first().fill('Svar från flik två');
    await flik2.getByRole('button', { name: 'Spara svar' }).first().click();
    await expect(flik2.locator('.status.sparat, .not.fel').first()).toBeVisible({ timeout: 20_000 });
    const svarTvaFlikar = (await hamtaSomSida(flik2, bas + '/api/lage')).text; // bara för att visa att fliken lever
    expect(svarTvaFlikar.length).toBeGreaterThan(0);
    const ex2 = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as { svar: { fraga_id: string; text: string; ersatter?: number }[] };
    const svarF2 = ex2.svar.filter((x) => x.fraga_id === fragaId2);
    expect(svarF2.map((x) => x.text)).toEqual(['Svar från flik ett', 'Svar från flik två']);
    expect(svarF2[1].ersatter).toBeDefined();
    const igen = await flik2.evaluate(async (fid) => (await fetch('/api/svar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fraga_id: fid, text: 'Svar från flik två', typ: 'text', idempotens: 'nyckel-' + Math.random().toString(16).slice(2, 12) }) })).json(), fragaId2);
    expect((igen as { ny: boolean }).ny).toBe(false);
    await expect(flik2.locator('h2.fragetext').first()).toBeVisible({ timeout: 60_000 });
    const vetInteId = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}`, { headers: internHuvud() })).json()).vy.oppna[0].id as string;
    for (let i = 0; i < 2; i++) await flik2.evaluate(async (fid) => fetch('/api/svar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fraga_id: fid, text: '', typ: 'vet_inte', idempotens: 'vetinte-' + fid + '-samma' }) }), vetInteId);
    await flik2.evaluate(async (fid) => fetch('/api/svar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fraga_id: fid, text: '', typ: 'vet_inte', idempotens: 'vetinte-' + fid + '-annan' }) }), vetInteId);
    const ex3 = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as { svar: { fraga_id: string; text: string }[] };
    expect(ex3.svar.filter((x) => x.fraga_id === fragaId2).length).toBe(2);
    expect(ex3.svar.filter((x) => x.fraga_id === vetInteId).length, 'tre Vet inte-anrop ger en rad').toBe(1);
    await flik2.close();
    // Ny enhet: samma länk i ny kontext ger samma ärende och svar
    const ctx2 = await browser.newContext();
    const sida2 = await ctx2.newPage();
    await oppna(sida2, a.lank);
    await expect(sida2.locator('.dialog li').first()).toContainText('Ett svar som inte är sparat än');
    await ctx2.close();
  });

  test('rätta förståelsen utan omstart; AI-tolkning viker för kundens rättelse; "vet inte" hanteras', async ({ page, request, baseURL }) => {
    const bas = baseURL!;
    const a = await skapaArende(request, bas, 'Testfirma Rättelse');
    await oppna(page, a.lank);
    const f1 = await aktuellFraga(page);
    await page.getByRole('button', { name: 'Vet inte' }).first().click();
    await expect(page.locator('.dialog li .svar.vet-inte').first()).toHaveText('Vet inte');
    await vantaPaNyFraga(page, f1);
    // Rätta det förifyllda erbjudandet under Vår bild
    await page.getByRole('tab', { name: /Vår bild av er/ }).click();
    const rad = page.locator('.bild-rad', { hasText: 'Vad ni erbjuder' });
    await rad.getByRole('button', { name: 'Ändra' }).click();
    await rad.locator('textarea.ratt-falt').fill('Klippning och färgning. Skäggtrimning har vi slutat med.');
    await rad.getByRole('button', { name: 'Spara rättelse' }).click();
    await expect(rad.locator('.varde')).toHaveText('Klippning och färgning. Skäggtrimning har vi slutat med.');
    await expect(rad.locator('.ursprung')).toContainText('Ni uppgav detta');
    // En andra rättelse av samma uppgift sparas också (ny nyckel per handling); samma värde igen ger tydligt besked
    await rad.getByRole('button', { name: 'Ändra' }).click();
    await rad.locator('textarea.ratt-falt').fill('Bara klippning numera.');
    await rad.getByRole('button', { name: 'Spara rättelse' }).click();
    await expect(rad.locator('.varde')).toHaveText('Bara klippning numera.');
    // Samma värde igen: knappen är avstängd i gränssnittet, och servern sparar ingen ny rad om anropet ändå görs
    await rad.getByRole('button', { name: 'Ändra' }).click();
    await rad.locator('textarea.ratt-falt').fill('Bara klippning numera. ');
    await expect(rad.getByRole('button', { name: 'Spara rättelse' })).toBeDisabled();
    await rad.getByRole('button', { name: 'Avbryt' }).click();
    const samma = await page.evaluate(async () => (await fetch('/api/rattelse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nyckel: 'erbjudande', varde: 'Bara klippning numera.', idempotens: 'ratt-' + Math.random().toString(16).slice(2, 12) }) })).json());
    expect((samma as { ny: boolean }).ny).toBe(false);
    const ex = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as { rattelser: { nyckel: string; varde: string; tidigare: { typ: string } }[]; rattelser_fakta: { status: string; kalla: string }[] };
    expect(ex.rattelser.map((r) => r.varde)).toEqual(['Klippning och färgning. Skäggtrimning har vi slutat med.', 'Bara klippning numera.']);
    expect(ex.rattelser[0].tidigare.typ).toBe('forifylld'); // AI-stödet får inte skriva om en orörd förifylld uppgift som sin tolkning
    expect(ex.rattelser_fakta[0].status).toBe('kunden uppger');
    // Samtalet fortsätter där det var
    await page.getByRole('tab', { name: 'Samtal' }).click();
    await expect(page.locator('h2.fragetext').first()).toBeVisible();
  });

  test('material: tillåten fil tas emot, otillåten avvisas, borttagning fungerar, länk sparas', async ({ page, request, baseURL }) => {
    const bas = baseURL!;
    const a = await skapaArende(request, bas, 'Testfirma Material');
    await oppna(page, a.lank);
    await page.getByRole('tab', { name: /Material/ }).click();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await page.locator('input[type=file]').setInputFiles({ name: 'logotyp.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('.material-lista li', { hasText: 'logotyp.png' })).toBeVisible({ timeout: 20_000 });
    // Samma fil igen (återförsök): ingen kopia
    await page.locator('input[type=file]').setInputFiles({ name: 'logotyp.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('#material-status')).toContainText('fanns redan', { timeout: 20_000 });
    await expect(page.locator('.material-lista li')).toHaveCount(1);
    // Otillåten: en körbar fil med bildändelse
    await page.locator('input[type=file]').setInputFiles({ name: 'farlig.png', mimeType: 'image/png', buffer: Buffer.from('MZ\u0000\u0000detta är inte en bild') });
    await expect(page.locator('.not.fel')).toContainText('ser inte ut som en sådan fil');
    await expect(page.locator('.material-lista li')).toHaveCount(1);
    // Länk
    await page.locator('#url').fill('https://exempel.test/var-sida');
    await page.getByRole('button', { name: 'Spara länk' }).click();
    await expect(page.locator('.material-lista li', { hasText: 'exempel.test' })).toBeVisible();
    // Hämta filen som kund, jämför byte för byte
    const href = (await page.locator('.material-lista li a').first().getAttribute('href'))!;
    const svar = await hamtaSomSida(page, bas + href);
    expect(svar.status).toBe(200);
    expect(Buffer.from(svar.base64, 'base64').equals(png)).toBe(true);
    // Ta bort med bekräftelse
    const post = page.locator('.material-lista li', { hasText: 'logotyp.png' });
    await post.getByRole('button', { name: 'Ta bort' }).click();
    await post.getByRole('button', { name: 'Ja, ta bort' }).click();
    await expect(page.locator('.material-lista li', { hasText: 'logotyp.png' })).toHaveCount(0);
  });

  test('kund A når inte kund B; ogiltig, felaktig och återkallad länk hanteras', async ({ page, request, baseURL, browser }) => {
    const bas = baseURL!;
    const a = await skapaArende(request, bas, 'Kund A');
    const b = await skapaArende(request, bas, 'Kund B');
    await oppna(page, a.lank);
    // Kund A laddar upp en fil
    await page.getByRole('tab', { name: /Material/ }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hemligt för A') });
    await expect(page.locator('.material-lista li', { hasText: 'a.txt' })).toBeVisible({ timeout: 20_000 });
    const href = await page.locator('.material-lista li a').first().getAttribute('href');
    // Kund B (egen kontext) försöker läsa A:s fil och lägga svar i A:s ärende
    const ctxB = await browser.newContext();
    const sidaB = await ctxB.newPage();
    await oppna(sidaB, b.lank);
    const r1 = await hamtaSomSida(sidaB, bas + href!);
    expect(r1.status).toBe(404);
    const lageB = JSON.parse((await sidaB.evaluate(async () => (await fetch('/api/lage')).text())) as string);
    expect(lageB.arende.kund.namn).toBe('Kund B');
    expect(lageB.material.length).toBe(0);
    await ctxB.close();
    // Utan kaka: 401 på API, omdirigering på sidan
    const ctxC = await browser.newContext();
    const sidaC = await ctxC.newPage();
    expect((await sidaC.request.get(bas + '/api/lage')).status()).toBe(401);
    await sidaC.goto(bas + '/samtal');
    await expect(sidaC).toHaveURL(/\/lank\?skal=session/);
    // Felaktig länk
    await sidaC.goto(bas + '/start#' + 'x'.repeat(43));
    await expect(sidaC).toHaveURL(/\/lank\?skal=ogiltig/);
    // Intern API utan nyckel
    expect((await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`)).status()).toBe(401);
    await ctxC.close();
    // Återkalla A:s länk: A:s befintliga session slutar gälla och länken går inte att öppna igen
    const ak = await request.delete(`${bas}/api/intern/arenden/${a.arende_id}/lankar/${a.lank_hash}`, { headers: internHuvud() });
    expect(ak.ok()).toBe(true);
    await page.goto(bas + '/samtal');
    await expect(page).toHaveURL(/\/lank\?skal=aterkallad/);
    await page.goto(a.lank);
    await expect(page).toHaveURL(/\/lank\?skal=aterkallad/);
  });

  test('inlämning bekräftar vad som lämnats och vad som händer, utan godkännande', async ({ page, request, baseURL }) => {
    const bas = baseURL!;
    const a = await skapaArende(request, bas, 'Testfirma Inlämning');
    await oppna(page, a.lank);
    await aktuellFraga(page);
    await svara(page, 'Vi vill få fler förfrågningar om trädgårdsskötsel från villaägare i Luleå.');
    await page.getByRole('button', { name: 'lämna in det ni har hittills' }).click();
    await expect(page.getByRole('heading', { name: /Tack, Testfirma Inlämning/ })).toBeVisible();
    await expect(page.getByText('1 svar i samtalet')).toBeVisible();
    await expect(page.getByText('inte ett godkännande av en design')).toBeVisible();
    const lage = await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}`, { headers: internHuvud() })).json();
    expect(lage.inlamningar.length).toBe(1);
  });
});
