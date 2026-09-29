import { expect, test } from '@playwright/test';
import { aktuellFraga, hamtaSomSida, internHuvud, oppna, skapaArende, svara, tillbakaTillSamtalet, vantaPaNyFraga, vantaPaSparat, visaUppdrag } from './hjalp';

// Regelstyrt läge (ingen modell): samtalets mekanik, samma ärende i samtal och översikt, återupptagning, rättelse,
// material, kundseparation och inlämning. Agentens modellturer provas i ai.spec.ts.
test.describe('Kundstart – samtal, Ditt uppdrag, återupptagning, rättelse, material, inlämning', () => {
  test('bokningsbehov ger bokningsfrågor; informationsbehov med negation gör det inte', async ({ page, request, baseURL }) => {
    const bas = baseURL!;
    const a = await skapaArende(request, bas, 'Testsalong Bokning');
    await oppna(page, a.lank);
    await expect(page.getByRole('heading', { name: /(Hej|God morgon|God kväll), Testsalong Bokning/ })).toBeVisible();
    await expect(page.getByText('Det här vet vi redan')).toBeVisible();
    const f1 = await aktuellFraga(page);
    expect(f1).toContain('Berätta med egna ord');
    await svara(page, 'Vi vill att kunder ska kunna boka tid direkt på hemsidan i stället för att ringa. Just nu skriver vi allt i en papperskalender.');
    let hittadBokning = false;
    let forra = f1;
    for (let i = 0; i < 6 && !hittadBokning; i++) {
      const f = await vantaPaNyFraga(page, forra);
      forra = f;
      if (/bok/i.test(f)) { hittadBokning = true; break; }
      await svara(page, 'Vet inte riktigt, det får ni gärna föreslå.');
    }
    expect(hittadBokning, 'ett bokningsbehov ska ge bokningsfrågor').toBe(true);

    const b = await skapaArende(request, bas, 'Testbyrå Information');
    await page.context().clearCookies();
    await oppna(page, b.lank);
    const g1 = await aktuellFraga(page);
    await svara(page, 'Vi vill bara att folk ska hitta våra öppettider och adress och förstå vad vi gör. Inga bokningar via nätet, folk ringer.');
    let forraB = g1;
    for (let i = 0; i < 3; i++) {
      forraB = await vantaPaNyFraga(page, forraB);
      await svara(page, 'Det är mest privatpersoner i närområdet som hör av sig.');
    }
    const exB = (await (await request.get(`${bas}/api/intern/arenden/${b.arende_id}/export`, { headers: internHuvud() })).json()) as { omgangar: { fragor: { id: string }[] }[]; foljdregler_utlosta: { regel: string }[]; foljdregler_negerade: { regel: string }[] };
    expect(exB.foljdregler_utlosta.some((r) => r.regel === 'bokning'), 'ett informationsbehov ska inte utlösa bokningsregeln').toBe(false);
    expect(exB.foljdregler_negerade.some((r) => r.regel === 'bokning'), 'den negerade nämningen bokförs som negerad').toBe(true);
    expect(exB.omgangar.flatMap((o) => o.fragor).some((f) => /^BOK/.test(f.id)), 'inga BOK-följdfrågor för ett informationsbehov').toBe(false);

    const paket = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as { schema: string; arende: { testdialog: boolean }; svar: { fraga_id: string; text: string }[]; omgangar: { svar_md: string }[]; foljdregler_utlosta: { regel: string }[] };
    expect(paket.schema).toBe('kundstart-export/1');
    expect(paket.arende.testdialog).toBe(true);
    expect(paket.svar[0].fraga_id).toBe('AG1');
    expect(paket.svar[0].text).toContain('boka tid direkt på hemsidan');
    expect(paket.omgangar.map((o) => o.svar_md).join('\n')).toMatch(/^### [A-Z]+\d+$/m);
    expect(paket.foljdregler_utlosta.some((r) => r.regel === 'bokning')).toBe(true);
  });

  test('samtal och Ditt uppdrag visar samma ärende; rättelse i översikten vinner och syns efter omladdning', async ({ page, request, baseURL }) => {
    const bas = baseURL!;
    const a = await skapaArende(request, bas, 'Testfirma Rättelse');
    await oppna(page, a.lank);
    await aktuellFraga(page);
    await svara(page, 'Vi vill få fler förfrågningar om trädgårdsskötsel från villaägare.');
    await vantaPaNyFraga(page, 'Berätta med egna ord: vad gör ni, och vad vill ni att webbplatsen ska hjälpa er med?');
    let uppdrag = await visaUppdrag(page);
    const mal = uppdrag.locator('#avsnitt-mal .bild-rad').first();
    await expect(mal.locator('.varde')).toContainText('fler förfrågningar om trädgårdsskötsel');
    await expect(mal.locator('.ursprung')).toContainText('Era ord');
    const erb = uppdrag.locator('.bild-rad', { hasText: 'Vad ni erbjuder' });
    await expect(erb.locator('.ursprung')).toContainText('Från er befintliga webbplats');
    await erb.getByRole('button', { name: /Ändra/ }).click();
    await erb.locator('textarea.ratt-falt').fill('Klippning och färgning. Skäggtrimning har vi slutat med.');
    await erb.getByRole('button', { name: 'Spara rättelse' }).click();
    await expect(erb.locator('.varde')).toHaveText('Klippning och färgning. Skäggtrimning har vi slutat med.');
    await expect(erb.locator('.ursprung')).toContainText('Er rättelse');
    await erb.getByRole('button', { name: /Ändra/ }).click();
    await erb.locator('textarea.ratt-falt').fill('Klippning och färgning. Skäggtrimning har vi slutat med. ');
    await expect(erb.getByRole('button', { name: 'Spara rättelse' })).toBeDisabled();
    await erb.getByRole('button', { name: 'Avbryt' }).click();
    const samma = await page.evaluate(async () => (await fetch('/api/rattelse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nyckel: 'erbjudande', varde: 'Klippning och färgning. Skäggtrimning har vi slutat med.', idempotens: 'ratt-' + Math.random().toString(16).slice(2, 12) }) })).json());
    expect((samma as { ny: boolean }).ny).toBe(false);
    await page.reload();
    uppdrag = await visaUppdrag(page);
    await expect(uppdrag.locator('.bild-rad', { hasText: 'Vad ni erbjuder' }).locator('.varde')).toHaveText('Klippning och färgning. Skäggtrimning har vi slutat med.');
    const ex = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as { rattelser: { varde: string; tidigare: { typ: string } }[]; rattelser_fakta: { status: string }[] };
    expect(ex.rattelser.map((r) => r.varde)).toEqual(['Klippning och färgning. Skäggtrimning har vi slutat med.']);
    expect(ex.rattelser[0].tidigare.typ).toBe('forifylld');
    expect(ex.rattelser_fakta[0].status).toBe('kunden uppger');
    await tillbakaTillSamtalet(page);
    await expect(page.locator('h2.fragetext').first()).toBeVisible();
  });

  test('återupptagning efter omladdning, bakåt och ny enhet; dubbelklick och två flikar ger inte dubbla svar', async ({ page, request, baseURL, browser }) => {
    const bas = baseURL!;
    const a = await skapaArende(request, bas, 'Testfirma Återupptagning');
    await oppna(page, a.lank);
    const f1 = await aktuellFraga(page);
    await page.locator('textarea.svar-falt').first().fill('Ett svar som inte är skickat än');
    await expect(page.locator('.status.osparad').first()).toHaveText('Inte skickat än');
    await page.reload();
    await expect(page.locator('h2.fragetext').first()).toHaveText(f1);
    await expect(page.locator('textarea.svar-falt').first()).toHaveValue('Ett svar som inte är skickat än');
    await page.getByRole('button', { name: 'Skicka svar' }).first().dblclick();
    await vantaPaSparat(page, 'Ett svar som inte är skickat än');
    const f2 = await vantaPaNyFraga(page, f1);
    const lage1 = await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}`, { headers: internHuvud() })).json();
    expect(lage1.vy.dialog.length).toBe(1);
    await page.goBack().catch(() => undefined);
    await page.goto(bas + '/samtal');
    await expect(page.locator('h2.fragetext').first()).toHaveText(f2);
    await expect(page.locator('.logg li')).toHaveCount(1);
    const flik2 = await page.context().newPage();
    await flik2.goto(bas + '/samtal');
    await expect(flik2.locator('h2.fragetext').first()).toHaveText(f2);
    const fragaId2 = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}`, { headers: internHuvud() })).json()).vy.oppna[0].id as string;
    await svara(page, 'Svar från flik ett');
    await flik2.locator('textarea.svar-falt').first().fill('Svar från flik två');
    await flik2.getByRole('button', { name: 'Skicka svar' }).first().click();
    await expect(flik2.locator('.logg .kund', { hasText: 'Svar från flik två' }).or(flik2.locator('.not.fel')).first()).toBeVisible({ timeout: 20_000 });
    const ex2 = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as { svar: { fraga_id: string; text: string; ersatter?: number }[] };
    const svarF2 = ex2.svar.filter((x) => x.fraga_id === fragaId2);
    expect(svarF2.map((x) => x.text)).toEqual(['Svar från flik ett', 'Svar från flik två']);
    expect(svarF2[1].ersatter).toBeDefined();
    const igen = await flik2.evaluate(async (fid) => (await fetch('/api/svar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fraga_id: fid, text: 'Svar från flik två', typ: 'text', idempotens: 'nyckel-' + Math.random().toString(16).slice(2, 12) }) })).json(), fragaId2);
    expect((igen as { ny: boolean }).ny).toBe(false);
    await flik2.close();
    const ctx2 = await browser.newContext();
    const sida2 = await ctx2.newPage();
    await oppna(sida2, a.lank);
    await expect(sida2.locator('.logg li').first()).toContainText('Ett svar som inte är skickat än');
    await ctx2.close();
  });

  test('material: tillåten fil tas emot, otillåten avvisas, borttagning fungerar, länk sparas', async ({ page, request, baseURL }) => {
    const bas = baseURL!;
    const a = await skapaArende(request, bas, 'Testfirma Material');
    await oppna(page, a.lank);
    const uppdrag = await visaUppdrag(page);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await uppdrag.locator('input[type=file]').setInputFiles({ name: 'logotyp.png', mimeType: 'image/png', buffer: png });
    await expect(uppdrag.locator('.material-lista li', { hasText: 'logotyp.png' })).toBeVisible({ timeout: 20_000 });
    await expect(uppdrag.locator('.material-lista li', { hasText: 'logotyp.png' })).toContainText('ännu inte läst');
    await uppdrag.locator('input[type=file]').setInputFiles({ name: 'logotyp.png', mimeType: 'image/png', buffer: png });
    await expect(uppdrag.locator('#material-status')).toContainText('fanns redan', { timeout: 20_000 });
    await expect(uppdrag.locator('.material-lista li')).toHaveCount(1);
    await uppdrag.locator('input[type=file]').setInputFiles({ name: 'farlig.png', mimeType: 'image/png', buffer: Buffer.from('MZ\u0000\u0000detta är inte en bild') });
    await expect(uppdrag.locator('.not.fel')).toContainText('ser inte ut som en sådan fil');
    await expect(uppdrag.locator('.material-lista li')).toHaveCount(1);
    await uppdrag.locator('input[type=file]').setInputFiles({ name: 'prislista.txt', mimeType: 'text/plain', buffer: Buffer.from('Service 495 kr. Däckbyte 250 kr.') });
    await expect(uppdrag.locator('.material-lista li', { hasText: 'prislista.txt' })).toContainText('texten är utläst men ännu inte genomläst', { timeout: 20_000 });
    await uppdrag.locator('#url').fill('https://exempel.test/var-sida');
    await uppdrag.getByRole('button', { name: 'Spara länk' }).click();
    await expect(uppdrag.locator('.material-lista li', { hasText: 'exempel.test' })).toBeVisible();
    const href = (await uppdrag.locator('.material-lista li a').first().getAttribute('href'))!;
    const svar = await hamtaSomSida(page, bas + href);
    expect(svar.status).toBe(200);
    expect(Buffer.from(svar.base64, 'base64').equals(png)).toBe(true);
    const post = uppdrag.locator('.material-lista li', { hasText: 'logotyp.png' });
    await post.getByRole('button', { name: 'Ta bort' }).click();
    await post.getByRole('button', { name: 'Ja, ta bort' }).click();
    await expect(uppdrag.locator('.material-lista li', { hasText: 'logotyp.png' })).toHaveCount(0);
  });

  test('kund A når inte kund B; ogiltig, felaktig och återkallad länk hanteras', async ({ page, request, baseURL, browser }) => {
    const bas = baseURL!;
    const a = await skapaArende(request, bas, 'Kund A');
    const b = await skapaArende(request, bas, 'Kund B');
    await oppna(page, a.lank);
    const uppdrag = await visaUppdrag(page);
    await uppdrag.locator('input[type=file]').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hemligt för A') });
    await expect(uppdrag.locator('.material-lista li', { hasText: 'a.txt' })).toBeVisible({ timeout: 20_000 });
    const href = await uppdrag.locator('.material-lista li a').first().getAttribute('href');
    const ctxB = await browser.newContext();
    const sidaB = await ctxB.newPage();
    await oppna(sidaB, b.lank);
    const r1 = await hamtaSomSida(sidaB, bas + href!);
    expect(r1.status).toBe(404);
    const lageB = JSON.parse((await sidaB.evaluate(async () => (await fetch('/api/lage')).text())) as string);
    expect(lageB.arende.kund.namn).toBe('Kund B');
    expect(lageB.material.length).toBe(0);
    const tillvalB = await sidaB.evaluate(async () => (await fetch('/api/tillval', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tillval: 'bokning', kundval: 'onskat', idempotens: 'kundb-tillval-01' }) })).json());
    expect((tillvalB as { vy: { arende: { kund: { namn: string } } } }).vy.arende.kund.namn, 'B:s val hamnar i B:s ärende').toBe('Kund B');
    const exA = (await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`, { headers: internHuvud() })).json()) as { tillval: { id: string }[] };
    expect(exA.tillval.some((t) => t.id === 'bokning'), 'A:s ärende påverkas inte').toBe(false);
    await ctxB.close();
    const ctxC = await browser.newContext();
    const sidaC = await ctxC.newPage();
    expect((await sidaC.request.get(bas + '/api/lage')).status()).toBe(401);
    expect((await sidaC.request.post(bas + '/api/tillval', { data: { tillval: 'bokning', kundval: 'onskat', idempotens: 'utan-kaka-01' } })).status()).toBe(401);
    await sidaC.goto(bas + '/samtal');
    await expect(sidaC).toHaveURL(/\/lank\?skal=session/);
    await sidaC.goto(bas + '/start#' + 'x'.repeat(43));
    await expect(sidaC).toHaveURL(/\/lank\?skal=ogiltig/);
    expect((await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`)).status()).toBe(401);
    expect((await request.get(`${bas}/api/intern/budget`)).status()).toBe(401);
    await ctxC.close();
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
    await expect(page.locator('main.samtal-yta').getByText('Inlämnat och sparat hos oss. Väntar på att hämtas av Digitala.', { exact: false })).toBeVisible();
    const lage = await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}`, { headers: internHuvud() })).json();
    expect(lage.inlamningar.length).toBe(1);
    // Kunden vill berätta mer efter inlämningen; frågan som redan var öppen visas igen och ett nytt svar syns som ändring.
    await page.getByRole('button', { name: 'Jag vill berätta mer' }).click();
    await aktuellFraga(page);
    await svara(page, 'Vi har också öppet på lördagar under våren.');
    const oversikt = await visaUppdrag(page);
    await expect(oversikt.locator('.uppdrag-status')).toContainText('Ni har ändrat något efter inlämningen');
  });
});
