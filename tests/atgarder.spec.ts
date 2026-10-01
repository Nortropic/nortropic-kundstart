import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { aktuellFraga, borja, internHuvud, lasOchLamnaIn, oppna, oppnaAvsnitt, skapaArende, svara, tillGranskning, vantaPaNyFraga } from './hjalp';
const evidence = process.env.KUNDSTART_EVIDENS;

test('Vikskär: naturlig rättelse, tidig inlämning, säker HTML och returfråga i samma ärende', async ({page,request,baseURL}, info) => {
  // Provet tar ~2 min mot det delade testlagret (signallistan det bläddrar igenom växer för varje körning) och slog i den
  // ordinarie budgeten 120 s under samtidig last 2026-10-01; slow() tredubblar budgeten.
  test.slow();
  const bas = baseURL!;
  const a = await skapaArende(request,bas,'Vikskär Bildrum åtgärdsprov',[
    {nyckel:'erbjudande',varde:'Porträtt 45 minuter, 1 800 kr inklusive moms',status:'kunden uppger',kalla:'äldre syntetiskt underlag',omrade:'A'},
  ],{ai:'regelstyrd'});
  await oppna(page,a.lank);
  await borja(page);
  const f = await aktuellFraga(page);
  await svara(page,'Rättelse: porträttsessionen är numera 60 minuter, samma pris. Vi delar samma rum och ljusutrustning. Några bilder får inte visas innan rekryteringen är offentlig. Vi behöver påminnelser och vill undersöka Google Ads och Meta, med 3 000 respektive 1 500 kr per månad som planering, inget utgiftsmandat.');
  await vantaPaNyFraga(page,f);
  // Tidig inlämning: kunden avslutar efter en fråga, läser igenom och lämnar in; luckorna behålls.
  const uppdrag = await tillGranskning(page);
  await expect(uppdrag.locator('.bild-rad',{hasText:'Vad ni erbjuder'}).locator('.varde')).toContainText('60 minuter');
  await oppnaAvsnitt(uppdrag,'Material (valfritt)');
  const html = Buffer.from('<!doctype html><html><script>window.EXEKVERAT=true</script><h1>Gammal testsajt</h1><a href="/portratt.html">Porträtt 45 minuter</a><a href="/foretag.html">Företagsuppdrag</a></html>');
  await uppdrag.locator('input[type=file]').setInputFiles({name:'vikskar-gammal.html',mimeType:'text/html',buffer:html});
  const material = uppdrag.locator('.material-lista li',{hasText:'vikskar-gammal.html'});
  await expect(material).toBeVisible();
  await expect(material).toContainText('texten är utläst men ännu inte genomläst');
  expect(await page.evaluate(()=>Object.hasOwn(window,'EXEKVERAT'))).toBe(false);
  await lasOchLamnaIn(page);
  await expect(page.getByRole('heading',{name:/Tack, Vikskär/})).toBeVisible();
  await expect(page.locator('main.samtal-yta').getByText('Inlämnat och sparat hos oss. Väntar på att hämtas av Digitala.',{exact:false})).toBeVisible();
  const exp = await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`,{headers:internHuvud()});
  expect(exp.status()).toBe(200);
  const bytes = await exp.body(), paket = JSON.parse(bytes.toString());
  expect(paket.fas).toBe('inlamnat');
  expect(paket.behov.length).toBeGreaterThanOrEqual(4);
  expect(paket.tackning.some((t:{status:string})=>t.status==='inte_undersokt')).toBe(true);
  expect(paket.syntes.valjare).toBe('regelstyrd');
  expect(paket.material[0].extraktion.text).toContain('/portratt.html');
  expect(paket.material[0].extraktion.text).not.toContain('EXEKVERAT');
  expect(paket.material[0].lasstatus).toBe('extraherad');
  expect(paket.signal.revision).toBe(paket.arende.revision);
  let cursor: string | null = null; let hittad=false;
  do {
    const url = `${bas}/api/intern/signaler`+(cursor?'?cursor='+encodeURIComponent(cursor):'');
    const sr = await request.get(url,{headers:internHuvud()}); expect(sr.status()).toBe(200);
    const sida=await sr.json(); hittad ||= sida.signaler.some((s:{id:string})=>s.id===paket.signal.id); cursor=sida.cursor;
  } while(cursor);
  expect(hittad).toBe(true);
  const ack={signal_id:paket.signal.id,revision:paket.signal.revision,utforare:'digitala/atgardsprov',import_sha256:createHash('sha256').update(bytes).digest('hex')};
  for(let i=0;i<2;i++)expect((await request.post(`${bas}/api/intern/arenden/${a.arende_id}/kvittens`,{headers:internHuvud(),data:ack})).status()).toBe(200);
  expect((await request.post(`${bas}/api/intern/arenden/${a.arende_id}/material/${paket.material[0].id}/lasning`,{headers:internHuvud(),data:{sha256:paket.material[0].sha256,utforare:'digitala/atgardsprov',resultat:'Läst gammal tidsuppgift och båda migreringsvägarna i detta verifieringsprov; kundens senare 60 minuter har företräde.'}})).status()).toBe(200);
  const ret={idempotens:'RETUR-ATGARD-'+info.project.name,bas_revision:paket.arende.revision,utforare:'digitala/atgardsprov',fragor:[{nyckel:'buffert',text:'Hur mycket buffert behövs mellan fotograferingar?',paverkar:'Delat rum och gemensam utrustning'}]};
  const rr=await request.post(`${bas}/api/intern/arenden/${a.arende_id}/returfragor`,{headers:internHuvud(),data:ret});expect(rr.status(),await rr.text()).toBe(200);
  // Returfrågan öppnar samtalet igen; när den är besvarad går kunden tillbaka till granskningen.
  await page.reload();
  const card=page.locator('.aktuell',{hasText:ret.fragor[0].text});await expect(card).toBeVisible();
  await card.locator('textarea').fill('15 minuter är den nya syntetiska testregeln.');
  await card.getByRole('button',{name:'Skicka svar',exact:true}).click();
  await expect(page.locator('.granskning')).toBeVisible({timeout:20_000});
  await expect(page.locator('.transkript .tur',{hasText:'15 minuter är den nya syntetiska testregeln.'})).toContainText('Sparat');
  const slut=await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`,{headers:internHuvud()})).json();
  expect(slut.fas).toBe('granskning');
  expect(slut.signal.id).not.toBe(paket.signal.id);
  expect(slut.svar.some((s:{text:string})=>s.text.includes('15 minuter'))).toBe(true);
  expect(slut.material[0].lasstatus).toBe('last');
  expect((await request.get(`${bas}/api/intern/signaler`)).status()).toBe(401);
  if(evidence){writeFileSync(`${evidence}/E2E-${info.project.name}.json`,JSON.stringify({tid:new Date().toISOString(),arende_id:a.arende_id,export:slut,scope:'Faktisk lokal Next-app med verkligt privat Vercel Blob; verifieringskonsumenten gör API-hämtning/kvittens, inte schemalagd Runtime-import.'},null,2));await page.screenshot({path:`${evidence}/E2E-${info.project.name}.png`,fullPage:true});}
});

// Det verkliga modellprovet för intervjuaren ligger i ai.spec.ts (samma ärendeflöde, tur- och synteskontrakten).

test('Reviewregression: orelaterat pris/metadata bevaras och okänt behov går att följa upp', async ({page,request,baseURL},info) => {
  const a=await skapaArende(request,baseURL!,'Vikskär reviewrättningar',[
    {nyckel:'erbjudande',varde:'Porträtt 45 minuter, 1 800 kr',status:'kunden uppger',kalla:'äldre syntetiskt underlag',omrade:'A'},
  ],{ai:'regelstyrd'});
  await oppna(page,a.lank);
  await borja(page);
  let f=await aktuellFraga(page);
  await svara(page,'Vi menar att priset ska vara tydligt redan på startsidan. Vi arbetar med metadata och metallskyltar i metallram.');
  await vantaPaNyFraga(page,f);
  let paket=await (await request.get(`${baseURL}/api/intern/arenden/${a.arende_id}/export`,{headers:internHuvud()})).json();
  expect(paket.rattelser_fakta).toHaveLength(0);
  expect(paket.behov).toHaveLength(0);
  f=await aktuellFraga(page);
  await svara(page,'Vi behöver påminnelser inför porträttbesök.');
  await vantaPaNyFraga(page,f);
  // "Vet inte" sägs i ord: hela svaret sparas som ett ärligt okänt.
  const okant=page.locator('.aktuell').filter({hasText:'När behövs påminnelsen'});
  await okant.locator('textarea').fill('Vet inte');
  await okant.getByRole('button',{name:'Skicka svar',exact:true}).click();
  await expect(page.locator('.logg .kund.vet-inte').last()).toContainText('Sparat');
  const oversikt=await tillGranskning(page);
  await expect(oversikt.locator('#avsnitt-aterstar')).toContainText('ni vet inte ännu');
  const senare=oversikt.locator('#avsnitt-aterstar li',{hasText:'När behövs påminnelsen'});
  await expect(senare.getByRole('button',{name:'Svara nu'})).toBeVisible();
  await senare.getByRole('button',{name:'Svara nu'}).click();
  // Frågan öppnas i tråden; när den är besvarad är kunden tillbaka i granskningen.
  const follow=page.locator('.aktuell').filter({hasText:'När behövs påminnelsen'});
  await expect(follow).toBeVisible();
  await follow.locator('textarea').fill('24 timmar före besöket via den godkända kontaktvägen.');
  await follow.getByRole('button',{name:'Skicka svar',exact:true}).click();
  await expect(follow).toHaveCount(0);
  await expect(page.locator('.granskning')).toBeVisible({timeout:20_000});
  paket=await (await request.get(`${baseURL}/api/intern/arenden/${a.arende_id}/export`,{headers:internHuvud()})).json();
  await expect(page.getByRole('heading',{name:/Ni skrev att ni inte vet det säkert/})).toHaveCount(0);
  expect(paket.behov.find((b:{nyckel:string})=>b.nyckel==='paminnelser').status).toBe('besvarad');
  expect(paket.tackning.find((b:{nyckel:string})=>b.nyckel==='paminnelser').status).toBe('uppgift_finns');
  if(evidence){writeFileSync(`${evidence}/REVIEW-r2-${info.project.name}.json`,JSON.stringify({tid:new Date().toISOString(),arende_id:a.arende_id,export:paket,scope:'Verklig lokal Next-app + privat Blob. Regelstyrd intervju, negativ rättelse/ämnesklassning och återöppnat okänt behov.'},null,2));await page.screenshot({path:`${evidence}/REVIEW-r2-${info.project.name}.png`,fullPage:true});}
});
