import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { aktuellFraga, internHuvud, oppna, skapaArende, svara, vantaPaNyFraga } from './hjalp';
const evidence = process.env.KUNDSTART_EVIDENS;

test('Vikskär: naturlig rättelse, tidig inlämning, säker HTML och returfråga i samma ärende', async ({page,request,baseURL}, info) => {
  const bas = baseURL!;
  const a = await skapaArende(request,bas,'Vikskär Bildrum åtgärdsprov',[
    {nyckel:'erbjudande',varde:'Porträtt 45 minuter, 1 800 kr inklusive moms',status:'kunden uppger',kalla:'äldre syntetiskt underlag',omrade:'A'},
  ],{ai:'regelstyrd'});
  await oppna(page,a.lank);
  const f = await aktuellFraga(page);
  await svara(page,'Rättelse: porträttsessionen är numera 60 minuter, samma pris. Vi delar samma rum och ljusutrustning. Några bilder får inte visas innan rekryteringen är offentlig. Vi behöver påminnelser och vill undersöka Google Ads och Meta, med 3 000 respektive 1 500 kr per månad som planering, inget utgiftsmandat.');
  await vantaPaNyFraga(page,f);
  await page.getByRole('tab',{name:/Vår bild av er/}).click();
  await expect(page.locator('.bild-rad',{hasText:'Vad ni erbjuder'}).locator('.varde')).toContainText('60 minuter');
  await page.getByRole('tab',{name:/Material/}).click();
  const html = Buffer.from('<!doctype html><html><script>window.EXEKVERAT=true</script><h1>Gammal testsajt</h1><a href="/portratt.html">Porträtt 45 minuter</a><a href="/foretag.html">Företagsuppdrag</a></html>');
  await page.locator('input[type=file]').setInputFiles({name:'vikskar-gammal.html',mimeType:'text/html',buffer:html});
  const material = page.locator('.material-lista li',{hasText:'vikskar-gammal.html'});
  await expect(material).toBeVisible();
  await expect(material).toContainText('Text extraherad, ännu inte läst');
  expect(await page.evaluate(()=>Object.hasOwn(window,'EXEKVERAT'))).toBe(false);
  await page.getByRole('tab',{name:/Samtal/}).click();
  await page.getByRole('button',{name:'lämna in det ni har hittills'}).click();
  await expect(page.getByRole('heading',{name:/Tack, Vikskär/})).toBeVisible();
  await expect(page.getByText('Sparat och väntar på att hämtas av Digitala.',{exact:false})).toBeVisible();
  const exp = await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`,{headers:internHuvud()});
  expect(exp.status()).toBe(200);
  const bytes = await exp.body(), paket = JSON.parse(bytes.toString());
  expect(paket.behov.length).toBeGreaterThanOrEqual(4);
  expect(paket.tackning.some((t:{status:string})=>t.status==='inte_undersokt')).toBe(true);
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
  await page.reload();
  const card=page.locator('.aktuell',{hasText:ret.fragor[0].text});await expect(card).toBeVisible();
  await card.locator('textarea').fill('15 minuter är den nya syntetiska testregeln.');
  await card.getByRole('button',{name:'Spara svar',exact:true}).click();
  await expect(page.locator('.status.sparat').first()).toContainText('Sparat');
  const slut=await (await request.get(`${bas}/api/intern/arenden/${a.arende_id}/export`,{headers:internHuvud()})).json();
  expect(slut.signal.id).not.toBe(paket.signal.id);
  expect(slut.svar.some((s:{text:string})=>s.text.includes('15 minuter'))).toBe(true);
  expect(slut.material[0].lasstatus).toBe('last');
  expect((await request.get(`${bas}/api/intern/signaler`)).status()).toBe(401);
  if(evidence){writeFileSync(`${evidence}/E2E-${info.project.name}.json`,JSON.stringify({tid:new Date().toISOString(),arende_id:a.arende_id,export:slut,scope:'Faktisk lokal Next-app med verkligt privat Vercel Blob; verifieringskonsumenten gör API-hämtning/kvittens, inte schemalagd Runtime-import.'},null,2));await page.screenshot({path:`${evidence}/E2E-${info.project.name}.png`,fullPage:true});}
});

test('Vikskär: verklig befintlig gateway med samma GPT-5 mini och nytt schemakontrakt', async ({page,request,baseURL},info) => {
  test.skip(process.env.KUNDSTART_PROV_AI !== '1','Explicit avgränsat leverantörsprov');
  const a=await skapaArende(request,baseURL!,'Vikskär Bildrum AI-kontrakt',[],{ai:'gateway'});
  await oppna(page,a.lank);
  const f=await aktuellFraga(page);
  await svara(page,'Vi är en liten foto- och innehållsstudio. Porträtt är 60 minuter och kostar 1 800 kr inklusive moms med 300 kr deposition i testläge. Företagsuppdrag går till Sam och porträtt till Mira. Vi delar rum och ljusutrustning. Bilder av nya kollegor får inte visas innan rekryteringen är offentlig och tillstånd måste finnas separat. Vi vill undersöka Google Ads och Meta med en planeringsbudget, men inget får aktiveras eller spenderas.');
  await vantaPaNyFraga(page,f);
  const andra=await aktuellFraga(page);
  await svara(page,'Porträtt: 60 minuter och 1 800 kr inklusive moms. Bokning kräver samma rum och samma ljusutrustning, så två fotografer får aldrig boka överlappande tid. Företagsbilder kan behöva hållas hemliga till ett uttryckligt datum. Sam godkänner publicering och varje porträtt behöver separat bildtillstånd. Vi behöver en påminnelse och ska utreda Google Ads och Meta, men har bara en syntetisk planeringsbudget. En särskild risk är att en frilansare lämnar över bilder under ett gammalt projektnamn: kopplingen till rätt uppdrag måste kunna kontrolleras före publicering.');
  await vantaPaNyFraga(page,andra);
  const p=await (await request.get(`${baseURL}/api/intern/arenden/${a.arende_id}/export`,{headers:internHuvud()})).json();
  if(evidence)writeFileSync(`${evidence}/GATEWAY-${info.project.name}.json`,JSON.stringify({tid:new Date().toISOString(),arende_id:a.arende_id,ai:p.ai,handelser:p.handelser,behov:p.behov,scope:'Verkligt befintligt Vercel AI Gateway-anrop från lokal app, ingen modellväxling.'},null,2));
  expect(p.ai.modell).toBe('openai/gpt-5-mini');
  expect(p.behov.some((b:{metod:string;citat:string})=>b.metod==='ai'&&/projektnamn|frilansare|rätt uppdrag/.test(b.citat))).toBe(true);
  expect(p.ai.anrop).toBeGreaterThanOrEqual(2);
  const senaste=p.handelser.filter((h:{typ:string})=>h.typ==='nasta').at(-1);
  if(senaste.detaljer.fallback){expect(p.ai.aktuell).toBe('reserv');expect(senaste.detaljer.diagnostik.some((d:{avvisade?:unknown[]})=>d.avvisade?.length)).toBe(true);await expect(page.locator('.fot')).toContainText('reservläge');}
});
