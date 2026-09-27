# Kundstart: tillägg till export/1 och överlämning

Gäller denna kandidat. Den redan driftsatta versionen får inte tillskrivas ändringarna före införande.

## Samma ärende, beständig signal

Kundens inlämning och senare svar, rättelse eller materialändring skriver `signal` i **samma** villkorade Blob-skrivning som ändringen. Ingen separat osäker dual-write-kö finns. Flera ändringar samlas till senaste revision; svar/rättelsehistoriken finns kvar. Signalen är aldrig ensam bevis för import/research.

Alla följande vägar kräver befintlig intern Bearer, aldrig kundens sessionskaka:

- `GET /api/intern/signaler?cursor=...` → `{schema:"kundstart-signaler/1", signaler:[{id,arende_id,kund,revision,typ,skapad}],cursor}`. `cursor:null` avslutar en full scan. Konsumenten fortsätter alla sidor och börjar nästa schemalagda scan från början. Blob-listning kan bli synlig senare; en beständig cursor får därför inte användas som permanent vattenmärke. Varje sida omfattar högst 100 ärenden. Ingen kundnyckel eller kundtext returneras här.
- `POST /api/intern/arenden/{id}/kvittens` med `{signal_id,revision,utforare,import_sha256}`. Kvittens gäller exakt signalrevision; annan aktuell signal ger409. Identisk kvittens kan upprepas efter tappat svar. En redan kvitterad äldre signal får upprepas men stänger aldrig en nyare signal. Samma signal med annan utförare/hash ger409. Spara hämtade exportbyte och SHA beständigt före kvittens; exportens `exporterad`-klockslag gör en ny hämtning till nya byte.
- `POST /api/intern/arenden/{id}/returfragor` med `{idempotens,bas_revision,utforare,fragor:[{nyckel,text,paverkar}]}`. 1–6 frågor, tydlig verksamhetsorsak, exakt aktuell exportrevision. Frågorna får servergenererade `RET…`-id i befintliga samtalet. Dubblett är idempotent; samma nyckel med annat innehåll eller en gammal revision ger409. Svaret är ett vanligt ordagrant kundsvar och skapar en kompletteringssignal.
- `POST /api/intern/arenden/{id}/material/{mid}/lasning` med `{sha256,utforare,resultat}` är uttrycklig läskvittens för rätt original. Nedladdning innebär aldrig läst. Resultatet ska beskriva faktisk läsning. En kvittens är utförarens ansvariga utsaga, inte bevis för researchens kvalitet.

`arende.revision` är exportrevision och ökar även när frågor skapas. `signal.revision` är den revision där den senaste relevanta kundändringen skedde. Kvittens/läskvittens ändrar inte exportrevisionen. En modellrespons som var på väg när en ny revision skrevs bokförs men innehållet kasseras; kunden behåller senaste ord.

Konsumenten måste använda beständigt importläge och låsa per ärende före import. Signal-API startar inga agentsessioner. Schematisk upptäckt, faktisk import, research och återupptagning hör till den befintliga Digitala/Runtime-vägen och måste verifieras där; API-proven ersätter inte den kedjan.

## Export och kundens bild

`kundstart-export/1` behåller alla tidigare fält och lägger till `signal`, `kvittenser`, `returfragor`, `behov`, `tackning`. `behov` binder öppna behov till exakt kundcitat, fråge-id, revision och metod. Begränsade regler fångar publiceringsvillkor, delade resurser, påminnelser och marknadsföring även under ett annat frågefält. AI kan föreslå andra behov med citerat stöd; frågebanken är därför inte ett slutet tak. Fynd är öppna frågor tills kunden har svarat, aldrig automatiska produktkrav utan bearbetning.

Täckning skiljer `inte_undersokt`, `kunden_vet_inte`, `inte_tillampligt`, `atkomst_saknas`, `aterkom_senare`, befintlig kunduppgift och tolkning/förifyllnad att kontrollera. Tidig inlämning är tillåten och behåller luckorna. Kunden kan ange ett motiverat bortval eller beskriven saknad åtkomst genom egna knappar. Ett omnämnt behov är inte bevis för komplett affärsregel eller utgiftsmandat.

En tydlig sakrättelse om porträtt/session/pris över frågefält bevaras som kundens ord på erbjudanderaden med revisionskälla. Hela citatet bevaras, inga nya numeriska fakta räknas ut. Komplexa eller otydliga rättelser måste fortfarande utredas via behov/returfråga eller Vår bild; reglerna utger sig inte för att förstå all fri text.

## AI-kontrakt och ärlig felstatus

Samma standardmodell `openai/gpt-5-mini` behålls. OpenAI-vägen använder strikt JSON-schema och `max_completion_tokens`4000, högst ett till försök med8000. Slutorsak `length`, refusal, transport/HTTP, format och sakligt otillräckligt resultat särskiljs. Slutorsak och kända token sparas även vid misslyckande; timeoutens leverantörsförbrukning är okänd och de summerade token är bara de återrapporterade. En ostyrkt täcknings-/behovsrad avvisas separat med fält/id/källcitathash; den stänger ingen fråga. Andra giltiga källbundna behov bevaras och nästa fråga kommer från den ordinarie kandidaten för just det ostyrkta området. Detta visas som semantiskt reservläge, aldrig som helt lyckad tolkning; råa providerfel och råa modelltexter loggas inte. Permanenta HTTP-fel återförsöks inte. 429/5xx samt format/avkortning/semantik har högst två försök, timeout25sekunder per gatewayanrop; lång Retry-After går till reservväg.

Den historiska körningen sparade tre JSON-parsefel utan slutorsak. Avkortning är en möjlig orsak, inte ett fastställt historiskt faktum. Nya prov visar felvägarna separat. JSON-schemat bevisar struktur; kandidat-id och ordagranna källcitat kontrolleras dessutom. Kundens tidigare svar sparas före modellanrop. Gränssnittet visar aktivt, av, reserv eller paus även efter omladdning.

Kontrollerat mot [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Chat API](https://developers.openai.com/api/reference/resources/chat) och [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini)2026-09-27. Ett strikt schema ersätter inte hantering av avkortning eller vägran. `max_completion_tokens` omfattar också osynliga resonemangstoken.

## Material

HTML/HTM får tas emot som privat **källdokument**, aldrig som körbar sida. Originalet behålls byteidentiskt med SHA256, nedladdning är `attachment`+`nosniff`, ingen serverhämtning eller scriptkörning. Ett inert, begränsat textutdrag av HTML, TXT och CSV följer exporten. HTML-länkar till lokala/HTTP-adresser bevaras som text för migration; de hämtas inte. Parsern återger inte layout, bilder eller alla HTML-entiteter. Det tydliga extraktionsförbehållet följer med.

`lasstatus` skiljer mottagen, extraherad och läst. Original och utdrag är obetrodda källor, aldrig instruktioner till tjänstens rättigheter. PDF/Office/bildmaterial kräver fortsatt faktisk läsning i Digitalas avsedda verktyg. HTML-extraktionen gör inget anspråk på visuell webbsidesanalys.

## Verifiering

`npm run test:core`: isolerade domän-/CAS-/transportkontrakt med märkta providerersättare. `tests/atgarder.spec.ts`: verklig browser och privat Blob mot vald server, inklusive säker gammal HTML,60-minutersrättelse, tidig inlämning och returfråga. `KUNDSTART_PROV_AI=1` aktiverar ett begränsat verkligt gatewayprov. Dessa prov skapar enbart fiktiva testdialoger och skickar inga externa meddelanden. Hostad kundåtkomst och schematisk konsumtion har egna kvitton; lokala prov får inte tillskrivas dem.
