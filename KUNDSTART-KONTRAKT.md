# Kundstart: tillägg till export/1 och överlämning

Gäller denna kandidat. Den redan driftsatta versionen får inte tillskrivas ändringarna före införande.

## Samma ärende, beständig signal

Kundens inlämning och senare svar, rättelse eller materialändring skriver `signal` i **samma** villkorade Blob-skrivning som ändringen. Ingen separat osäker dual-write-kö finns. Flera ändringar samlas till senaste revision; svar/rättelsehistoriken finns kvar. Signalen är aldrig ensam bevis för import/research.

Alla följande vägar kräver befintlig intern Bearer, aldrig kundens sessionskaka:

- `GET /api/intern/signaler?cursor=...` → `{schema:"kundstart-signaler/1", signaler:[{id,arende_id,kund,revision,typ,skapad}],cursor}`. `cursor:null` avslutar en full scan. Konsumenten fortsätter alla sidor och börjar nästa schemalagda scan från början. Blob-listning kan bli synlig senare; en beständig cursor får därför inte användas som permanent vattenmärke. Varje sida omfattar högst 100 ärenden. Ingen kundnyckel eller kundtext returneras här.
- `POST /api/intern/arenden/{id}/kvittens` med `{signal_id,revision,utforare,import_sha256}`. Kvittens gäller exakt signalrevision; annan aktuell signal ger409. Identisk kvittens kan upprepas efter tappat svar. En redan kvitterad äldre signal får upprepas men stänger aldrig en nyare signal. Samma signal med annan utförare/hash ger409. Spara hämtade exportbyte och SHA beständigt före kvittens; exportens `exporterad`-klockslag gör en ny hämtning till nya byte.
- `POST /api/intern/arenden/{id}/returfragor` med `{idempotens,bas_revision,utforare,fragor:[{nyckel,text,paverkar}]}`. 1–6 frågor, tydlig verksamhetsorsak, exakt aktuell exportrevision. Frågorna får servergenererade `RET…`-id i befintliga samtalet. Dubblett är idempotent; samma nyckel med annat innehåll eller en gammal revision ger409. Svaret är ett vanligt ordagrant kundsvar och skapar en kompletteringssignal.
- `POST /api/intern/arenden/{id}/material/{mid}/lasning` med `{sha256,utforare,resultat}` är uttrycklig läskvittens för rätt original. Nedladdning innebär aldrig läst. Resultatet ska beskriva faktisk läsning. En kvittens är utförarens ansvariga utsaga, inte bevis för researchens kvalitet.

- `GET /api/intern/arenden?cursor=...` → `{schema:"kundstart-arenden/1", arenden:[{id,kund,testdialog,skapad,uppdaterad,revision,svar,material,senaste_inlamning,andrat_efter_inlamning}],cursor}`. En intern översikt för ägarens arbetsplats: bara metadata (kund är kundens namn, svar och material är antal), aldrig kundtext, svar, material, länkar eller nyckelhashar. Samma sidindelning som signalerna, högst 100 ärenden per sida, och samma förbehåll: Blob-listningen kan bli synlig senare, så en sparad cursor är inget permanent vattenmärke. `olasbara` räknar dokument på sidan som inte gick att läsa som ärenden; de fäller inte listan. Läser och ändrar ingenting annat.

`arende.revision` är exportrevision och ökar även när frågor skapas. `signal.revision` är den revision där den senaste relevanta kundändringen skedde. Kvittens/läskvittens ändrar inte exportrevisionen. En modellrespons som var på väg när en ny revision skrevs bokförs men innehållet kasseras; kunden behåller senaste ord.

Konsumenten måste använda beständigt importläge och låsa per ärende före import. Signal-API startar inga agentsessioner. Schematisk upptäckt, faktisk import, research och återupptagning hör till den befintliga Digitala/Runtime-vägen och måste verifieras där; API-proven ersätter inte den kedjan.

## Export och kundens bild

`kundstart-export/1` behåller alla tidigare fält och lägger till `signal`, `kvittenser`, `returfragor`, `behov`, `tackning`. `behov` binder öppna behov till exakt kundcitat, fråge-id, revision och metod. Begränsade regler fångar publiceringsvillkor, delade resurser, påminnelser och marknadsföring även under ett annat frågefält. AI kan föreslå andra behov med citerat stöd; frågebanken är därför inte ett slutet tak. Behovsstatus är `oppen`, `tackt` (AI-tolkning, inte kundbekräftelse) eller `besvarad`. Vet inte/saknad åtkomst lämnar behov öppet och frågan uppskjuten, med synlig återöppning i kundens täckningsbild. Äldre felmärkta AI-täckningar får härledd status vid vy/export. Fynd är aldrig automatiska produktkrav utan bearbetning.

Täckning skiljer `inte_undersokt`, `kunden_vet_inte`, `inte_tillampligt`, `atkomst_saknas`, `aterkom_senare`, befintlig kunduppgift och tolkning/förifyllnad att kontrollera. Tidig inlämning är tillåten och behåller luckorna. Kunden kan ange ett motiverat bortval eller beskriven saknad åtkomst genom egna knappar. Ett omnämnt behov är inte bevis för komplett affärsregel eller utgiftsmandat.

En tydlig sakrättelse om porträtt/session/pris över frågefält bevaras som kundens ord på erbjudanderaden med revisionskälla. Hela citatet bevaras, inga nya numeriska fakta räknas ut. Komplexa eller otydliga rättelser måste fortfarande utredas via behov/returfråga eller Vår bild; reglerna utger sig inte för att förstå all fri text.

## Intervjuagent, Ditt uppdrag och tillval (kandidat 2026-09-28)

Frågebanksledaren är ersatt av en intervjuagent (`lib/agent.ts`). Första frågan är fast (`AG1`, nyckel
`verksamhetsmal`); därefter formulerar agenten nästa fråga själv och servern ger den nästa `AG<n>`-id. Agentens
"verktyg" är strukturerade fält i ett strikt JSON-schema, inga funktionsanrop: `uppgifter` (notera_uppgift), `behov`,
`tillval` (en post per berört tillval med `grund` kundens_besked eller rekommendation), `tackning` (markera_tackning:
`kunden_vet_inte`, `inte_tillampligt`, `kunden_avstar`) och `research` (bestall_research). Varje post måste bära ett
ordagrant citat ur det namngivna kundsvaret eller materialet (`kalla_id`); annars avvisas den och avvisningen står i
händelsen `nasta`. Ett tillval blir kundens val bara när kundens verifierade citat bär det, oavsett vilken grund
modellen angav; utan citat blir det högst en rekommendation. En uppgift vars citat säger att kunden inte vet
("vi vet inte …") registreras som `kunden_vet_inte`, inte som känd uppgift. Research om domänens öppna uppgifter
avvisas (domänflödet gör det) liksom research formulerad som fråga till kunden (ni/er), som hör hemma i samtalet.
Samtidiga skrivningar som Vercel Blob avvisar (412 villkorsfel eller 409 "conflicting operation") läses om och försöks igen, högst sex gånger. Kundens eget val i översikten står alltid över ett äldre samtalsbaserat val; en rättelse ogiltigförklarar agentens
tolkning av samma uppgift. Ett agentsvar som kommer efter en nyare revision kasseras (`nasta_forkastad`). Agenten får
föreslå att samtalet räcker (`samtal_klar`) först när inget prioriterat område står helt orört eller efter 14 frågor.

Exporten `kundstart-export/1` behåller alla tidigare fält och lägger till:

- `kunduppgifter`: `{id,nyckel,rubrik,avsnitt,varde,citat,kalla_typ,kalla_id,kalla_revision,revision,omrade,tacker,status:"kunden uppger"}`.
  `tacker` är täckningsstödets nyckel som uppgiften helt eller delvis besvarar (eller `null`); den styr täckning och
  område när agenten gett uppgiften en egen nyckel. Agentens tolkningar (`status:"tolkning"`) går som förut till `fakta_ai`.
- `tillval`: `{id,beskrivning,kundval,system,not,kalla,citat,fraga_id,revision,rekommendation,digitala,kontroll,historik}`.
  `id` är ett katalog-id (`doman`, `formular`, `epost`, `bokning`, `betalning`, `crm`, `nyhetsbrev`, `cms`,
  `search_console`, `foretagsprofil`, `google_ads`, `meta_ads`, `matning`) eller `annat_<n>` för kundens egna behov.
  `kundval` är `onskat`, `har_system`, `hjalp`, `inte_nu` eller `null`. `kalla` är `kontroll` (kundens knapp) eller
  `samtal` (agenten, med `citat` och `fraga_id`). `rekommendation` är Digitalas/agentens förslag och aldrig kundens val.
  `digitala` är Digitalas status (`inkluderat`, `vantar_atkomst`, `anslutet_provat`). `kontroll` är domänkontrollen
  (DNS/RDAP, daterad). `historik` visar varje ändring, så att borttagning och ändring når Digitalas steg.
- `research`: agentens beställningar `{id,fraga,varfor,nyckel?,kalla_typ,kalla_id,citat,status:"bestalld",revision,tid,modell}`, högst sex. Kundstart hämtar
  ingenting; Digitalas research avgör och utför.
- `tackning_agent`: agentens citatbundna markeringar `{nyckel,lage,citat,fraga_id,revision,tid,giltig}` (vet inte / gäller
  inte / avstår). `tackning` tar hänsyn till dem.
- `samtal_klar`: `{revision,tid,meddelande,valjare}` när agenten bedömt att underlaget räcker; nytt svar öppnar samtalet igen.
- `ai`: även `kostnad_usd` (gatewayns faktiska kostnad), `okand_kostnad_usd`, `senaste_ms` och `budget_skal`.

Interna vägar (Bearer):

- `POST /api/intern/arenden/{id}/tillval` med `{tillval,status,not,kalla,utforare,idempotens}` sätter Digitalas status
  (`status:null` tar bort den). Administrativt: ingen ny kundrevision, ingen ny signal. `kalla` krävs.
- `GET /api/intern/budget` visar tak och månadens bokföring (faktisk kostnad, okänd förbrukning, vägrade anrop).

## Intervjuformat (kandidat 2026-10-01)

Kundstart följer Anthropic Interviewers format i fem faser som servern äger: `intro` (startskärm; `POST /api/borja`
ställer den fasta öppningsfrågan `AG1` med `roll:"oppning"`) → `intervju` (en tråd, en skrivruta; `POST /api/nasta`) →
`avslut` (avslutsmeddelandet och avslutsfrågan för sista tankar, `AG<n>` med `roll:"avslut"`, `nyckel:"avslut"`,
`omrade:"H"`; `POST /api/avsluta` låter kunden avsluta själv, varvid en obesvarad fråga skjuts upp) → `granskning`
(`POST /api/granska` skriver sammanfattningen; `{igen:true}` skriver om den) → `inlamnat` (`POST /api/inlamning`).
"Jag vill berätta mer" (`POST /api/nasta {fortsatt:true}`) öppnar samtalet igen från avslut, granskning eller inlamnat;
sammanfattningen får då `status:"inaktuell"`. Returfrågor från Digitala sätter fasen till intervju; när den sista är
besvarad går kunden tillbaka till granskningen. Äldre dokument utan `fas` härleds (inlamnat/intro/avslut/intervju) och
får fältet skrivet vid nästa övergång.

Modellarbetet är två kontrakt (`lib/agent.ts`): turen (`kundstart_tur`: `aterkoppling`, `fraga {text, nyckel, behov_id,
omrade, varfor}`, `tackning [{nyckel, lage: berord|tackt}]`, `klar`, `vagvisning`) och syntesen (`kundstart_syntes`:
`sammanfattning`, `nyckelinsikt`, `oppet`, samt de tidigare noteringarna `uppgifter`, `behov`, `tillval`, `tackning`,
`research` med samma citatkrav som förut). Frågans nyckel måste finnas i guiden (banken), vara ett öppet behov (med
`behov_id`) eller `avslut`; ett negerat följdämne som inte är utlöst förkastas och standardlistan ställer frågan i
stället. Avrundning godtas när `agentFragor >= 14` eller när inga viktiga områden står orörda och minst sex frågor
ställts (`KUNDSTART_AVSLUT_EFTER_FRAGOR` styr gränsen i prov); standardlistan rundar av med samma regel eller när den
är slut. Syntesen är idempotent (en aktuell sammanfattning skrivs inte om utan `igen`), körs under ärendets lås, kasserar
ett svar som kommer efter en nyare revision, lämnar ärendet i avslut vid fel (svaren orörda) och sammanställer kundens
svar deterministiskt efter tre fel (`valjare:"regelstyrd"`). Ett kvotbesked från `claude -p` ger felklassen `kvot`
(`ai.kvot {modell, aterstalls, besked}`), ingen paus och ingen räkning av fel i rad.

Inlämningen kräver kroppen `{idempotens, samtycke:{version:"samtycke/1", text, bekraftat:true, transkript_last:true}}`
med exakt den text som visades (`lib/samtycke.ts`; 422 annars) och fasen granskning eller inlamnat (409 annars).

Exporten `kundstart-export/1` behåller alla tidigare fält och lägger till:

- `fas` och `fas_historik`: `{fran, till, tid, revision, av: kund|ai|regelstyrd|digitala}`.
- `syntes`: `{id, status: klar|misslyckad|inaktuell, bas_revision, revision, tid, valjare: ai|regelstyrd, modell,
  anstrangning, ms, forsok, fel, sammanfattning, nyckelinsikt, oppet:[{nyckel, varfor}], avvisade}` eller `null`.
  Sammanfattningen är en tolkning; kundens ord och rättelser står över. Syntesens noteringar hamnar i de befintliga
  fälten (`kunduppgifter`, `fakta_ai`, `behov`, `tillval`, `tackning_agent`, `research`).
- `transkript`: hela intervjun i ordning, `{fraga_id, roll: oppning|fraga|avslut, inledning, fraga, stalld, valjare,
  status, svar:{text, typ, tid, andrad}|null}`.
- `berorda`: guidens nycklar som turerna berört eller täckt (`{nyckel, lage, fraga_id, revision}`); styr bara
  avrundningen, inte `tackning`.
- `arende.inlamningar[].samtycke`: `{version, text, tid, revision, syntes_id, transkript_last, idempotens}`.
- `omgangar[].fragor[].roll` (`oppning`/`avslut`) och `samtal_klar.valjare` kan vara `kund`.
- `ai.kvot` (modelltext, aldrig kundtext) och `ai.diagnostik[].cache_read`/`cache_write`.

Digitalas konsument (`verktyg/kundstart.py`) läser bara namngivna fält och ignorerar de nya; avslutsfrågan passerar
`giltig_fraga` och dess svar importeras som vilket svar som helst. Att visa `syntes` och `transkript` i INTERVJU.json
är en separat uppföljning i Digitala.

## AI-kontrakt och ärlig felstatus

AI-läget (2026-09-29): utan uttryckligt `KUNDSTART_AI` ställer standardlistan frågorna överallt, och gateway anropas bara med `KUNDSTART_AI=gateway`, även för äldre ärenden som skapades med gateway. Agenten provas i det lokala testläget (`claude-cli`, `npm run prov`) med den Claude-modell och ansträngning som väljs i skrivrutan; `GET`/`POST /api/prov/installningar` finns bara där och kräver session och huvudet `x-kundstart-prov: 1`. När gateway är påslagen gäller: standardmodellen `openai/gpt-5-mini`. Agentturen använder strikt JSON-schema, resonemangsnivå `low` och `max_completion_tokens` 6000, högst ett till försök med 10000 och bara när minst 25 av turens 45 sekunder återstår; varje försök reserverar sin kostnad före anropet (se DRIFT.md). Stycket nedan beskriver felklasserna, som gäller oförändrat. Slutorsak `length`, refusal, transport/HTTP, format och sakligt otillräckligt resultat särskiljs. Slutorsak och kända token sparas även vid misslyckande; timeoutens leverantörsförbrukning är okänd och de summerade token är bara de återrapporterade. En ostyrkt täcknings-/behovsrad avvisas separat med fält/id/källcitathash; den stänger ingen fråga. Andra giltiga källbundna behov bevaras och nästa fråga kommer från den ordinarie kandidaten för just det ostyrkta området. Detta visas som semantiskt reservläge, aldrig som helt lyckad tolkning; råa providerfel och råa modelltexter loggas inte. Permanenta HTTP-fel återförsöks inte. 429/5xx samt format/avkortning/semantik har högst två försök, högst 40 sekunder per gatewayanrop; lång Retry-After går till reservväg.

Den historiska körningen sparade tre JSON-parsefel utan slutorsak. Avkortning är en möjlig orsak, inte ett fastställt historiskt faktum. Nya prov visar felvägarna separat. JSON-schemat bevisar struktur; kandidat-id och ordagranna källcitat kontrolleras dessutom. Kundens tidigare svar sparas före modellanrop. Gränssnittet visar aktivt, av, reserv eller paus även efter omladdning.

Kontrollerat mot [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Chat API](https://developers.openai.com/api/reference/resources/chat) och [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini)2026-09-27. Ett strikt schema ersätter inte hantering av avkortning eller vägran. `max_completion_tokens` omfattar också osynliga resonemangstoken.

## Material

HTML/HTM får tas emot som privat **källdokument**, aldrig som körbar sida. Originalet behålls byteidentiskt med SHA256, nedladdning är `attachment`+`nosniff`, ingen serverhämtning eller scriptkörning. Ett inert, begränsat textutdrag av HTML, TXT och CSV följer exporten. HTML-länkar till lokala/HTTP-adresser bevaras som text för migration; de hämtas inte. Parsern återger inte layout, bilder eller alla HTML-entiteter. Det tydliga extraktionsförbehållet följer med.

`lasstatus` skiljer mottagen, extraherad och läst. Original och utdrag är obetrodda källor, aldrig instruktioner till tjänstens rättigheter. PDF/Office/bildmaterial kräver fortsatt faktisk läsning i Digitalas avsedda verktyg. HTML-extraktionen gör inget anspråk på visuell webbsidesanalys.

## Verifiering

`npm run test:core`: isolerade domän-/CAS-/transportkontrakt med märkta providerersättare, och (`tests/core/agent.cjs`) agentens citatkrav, låset, kassering av sena svar, kostnadsspärren, domänflödet och rättelsens företräde. `tests/atgarder.spec.ts`: verklig browser och privat Blob mot vald server, inklusive säker gammal HTML, 60-minutersrättelse, tidig inlämning och returfråga. `tests/tillval.spec.ts`: tillval, domänflödet, mobilarket och bredvid-layouten. `tests/ai.spec.ts` körs bara med `KUNDSTART_AI=gateway` eller `claude-cli` och gör en verklig agenttur. `tests/provlage.spec.ts` körs bara mot en server i testläget och prövar modellvalet i skrivrutan utan modellanrop. Dessa prov skapar enbart fiktiva testdialoger och skickar inga externa meddelanden. Hostad kundåtkomst och schematisk konsumtion har egna kvitton; lokala prov får inte tillskrivas dem.

## Rättelser och bevis efter separat granskning

Allmänna uttryck som ”vi menar att priset ska vara tydligt” ändrar inte erbjudandet. En automatisk fälträttelse är avsiktligt begränsad till ett uttryckligt `Rättelse: porträttsessionen är numera/nu N minuter` när det tidigare fältet redan beskriver ett porträtt med längd; tidigare värde och källa bevaras. Annan text förblir kundens svar och kan rättas uttryckligen i kundens bild. Regeln innebär inte allmän semantisk rättelseförståelse.

Material extraheras en gång före CAS-callbacken. Vid kast läses ärendet åter före städning: en oregistrerad Blob tas bort, en refererad Blob behålls även om skrivkvittot tappades. Om lagret även vägrar återläsning/radering kan städningen inte bekräftas; API-anropet ska då misslyckas, inte ge ett falskt lyckat besked. Ingen processkraschstäder eller separat lagringsplattform införs här.

`bank_snapshot.py --rev` verifierar källans exakta byte med `git show`, och grennamn måste innehålla revisionen i sin historik. `ren` mäts separat för källfilen i arbetsträdet; exporterad historisk fil har `ren:null` och `revision_verifierad:true`, inte påstått rent arbetsträd. Snapshoten kompilerar regex även i JavaScripts Unicode-läge före skrivning. `bank_kontroll.mjs` kontrollerar både angiven fil och revisionsblobben (`--repo` behövs för fristående exportfil).

Playwrights obundna `test-results*/.last-run.json` ignoreras och följer inte med i Git. Provkvitton ska knytas till kandidat/miljö/omfattning i separat evidens. Gatewayns större tokenbudget används endast efter faktisk avkortning, inte efter transportfel.
