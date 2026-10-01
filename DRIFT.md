# Drift — Kundstart

Läst mot Vercels dokumentation 2026-09-27 (AI Gateway pricing/authentication/OIDC, Vercel Blob, Functions limits).
Uppdaterad 2026-10-01 för intervjuformatet (Anthropic Interviewer): fem faser, turen och syntesen som två modellkontrakt,
kundens eget avslut, samtycke vid inlämning, kvotbesked per modell. Ingen deploy: produktionen kör fortfarande den
tidigare versionen tills ägaren driftsätter.
Uppdaterad 2026-09-28 för intervjuagenten, tillvalen, domänflödet och kostnadsspärren, och 2026-09-29 för ägarens besked:
bara prov nu, ingen kostnads-AI. Produktionen ställer standardlistans frågor utan modell, och AI-samtalet provas i det
lokala testläget på ägarens dator (Claude Code på ägarens inloggning, som förbättringspartnern). Gateway-vägen och
kostnadsspärren finns kvar i koden men är avstängda; de är den väg Anthropics villkor tillåter för riktiga kunder
(en Pro- eller Max-inloggning får inte svara någon annans användare).

## Var tjänsten kör

| Del | Var | Anmärkning |
|---|---|---|
| Webb och API | Vercel, team `nortropic` (Pro), projekt `nortropic-kundstart`, funktioner i `arn1` (Stockholm) | `vercel.json` sätter regionen; Fluid compute, standardkostnad inom Pro-krediten |
| Dokument och filer | Vercel Blob, lagret `nortropic-kundstart` (privat, region `arn1`) | OIDC på Vercel, `BLOB_READ_WRITE_TOKEN` lokalt; storlek och operationer räknas mot Pro-krediten |
| Modell i produktionen | ingen sedan 2026-09-29: standardlistan ställer frågorna | Vercel AI Gateway (`https://ai-gateway.vercel.sh`, OIDC, ingen API-nyckel) slås på bara med `KUNDSTART_AI=gateway`; fri nivå: `openai/gpt-5-mini`, `openai/gpt-4.1-mini`; Claude-modeller kräver köpta krediter (403 på fri nivå, uppmätt 2026-09-27) |
| Modell i testläget | ägarens Mac: `claude -p` på ägarens Claude Code-inloggning | `npm run prov -- start`; modell och ansträngning väljs i skrivrutan; bara ägarens egna prov |
| Domänkontroll | `cloudflare-dns.com` (DoH), `data.iana.org` (RDAP-bootstrap) och registrets RDAP-server | bara läsning av offentliga uppgifter, fasta värdar, ingen omdirigering; högst 10 kontroller per ärende och timme |
| Byggsession och testläge | ägarens Mac | produktionen beror inte på den; testläget (127.0.0.1:3131) kör bara när ägaren startat det |

## Miljövariabler

| Namn | Var | Vad |
|---|---|---|
| `KUNDSTART_HEMLIGHET` | Vercel (prod/preview sensitive, dev), 0600-kopia i `~/.nortropic-hemligheter/kundstart/` | signerar sessionskakan |
| `KUNDSTART_INTERN_NYCKEL` | samma | Bearer för `/api/intern/*` (Digitalas `verktyg/kundstart.py`) |
| `KUNDSTART_AI` | Vercel / lokalt | ej satt = `regelstyrd` överallt (standard sedan 2026-09-29) · `gateway` (slår på AI Gateway, även för äldre gateway-ärenden) · `claude-cli` (bara lokalt testläge; `npm run prov` sätter det) |
| `KUNDSTART_AI_MODELL` | Vercel | standard `openai/gpt-5-mini`; `anthropic/claude-haiku-4.5` när krediter finns |
| `KUNDSTART_AI_MAX_ANROP` | Vercel | AI-anrop per ärende (standard 60) |
| `KUNDSTART_AI_BUDGET_ARENDE_USD` / `_DYGN_USD` / `_MANAD_USD` | Vercel | kostnadstak per ärende / dygn (UTC) / kalendermånad, standard 0,40 / 1,00 / 3,50 USD |
| `KUNDSTART_AI_RESONEMANG` | Vercel | resonemangsnivå för gatewaymodellen, standard `low` (mätt: `minimal` registrerade 4–6 av 8 kundbesked om tillval rätt, `low` 8 av 8) |
| `KUNDSTART_PROV_DATA` | bara lokalt | testlägets katalog (standard `~/.nortropic-kundstart-prov`, 0700): `installningar.json` med turens modell och ansträngning och syntesens (`syntes_modell`, `syntes_anstrangning`); standard Opus 5.5 på `max` för båda (ägarens beslut 2026-10-01), logg, pid |
| `KUNDSTART_AVSLUT_EFTER_FRAGOR` | bara lokalt (prov) | frågegränsen för avrundning (standard 14); `3` i verkliga modellprov så att intervjuaren avrundar själv |
| `AI_GATEWAY_API_KEY` | valfri | ersätter OIDC (t.ex. kör utanför Vercel) |
| `BLOB_READ_WRITE_TOKEN`, `VERCEL_OIDC_TOKEN`, `BLOB_STORE_ID` | av Vercel | lagrets åtkomst |

## Gränser och missbruksskydd (serversidan)

- Länk: 256 bitar, hash i lagret, giltig 30 dagar (styrbart), återkallbar; kakan signerad, httpOnly, 30 dagar; alla
  kund-API:er kräver giltig kaka *och* giltig länk vid varje anrop.
- AI: högst `KUNDSTART_AI_MAX_ANROP` anrop per ärende och en agenttur i taget per ärende (lås i ärendet, 80 s). Före
  varje gatewayanrop reserveras anropets högsta möjliga kostnad (inmatade token plus `max_completion_tokens` till
  listpris) mot ärendets, dygnets och månadens tak i en villkorad skrivning av `budget/ai-<månad>.json`; efter anropet
  avräknas gatewayns faktiska `usage.cost`. Okänd kostnad (timeout) avräknas som hela reservationen. Når ett tak körs
  den regelstyrda vägen och sidfoten säger t.ex. "AI-stöd: pausat (dagens budget för AI-stödet är nådd)". Inga krediter
  köps och inget tak höjs automatiskt. Efter tre fel i rad pausas AI-stödet i tio minuter. En agenttur får 45 s (funktionens gräns är 60 s, resten
  räcker för slutskrivningen och domänkontrollen): ett gatewayanrop högst 40 s, ett andra försök bara när minst 25 s
  återstår. Ett fel efter att turen tagit ärendets lås släpper låset direkt och kunden ser "Försök igen". En modellrespons som kommer efter en nyare kundändring bokförs men kasseras.
  Syntesens noteringar godtas bara med ordagrant citat ur namngivet kundsvar eller material; researchbeställningar är
  högst sex per ärende och startar ingen hämtning i Kundstart. Fri text från kunden startar aldrig verktygsloopar
  eller webbhämtning. Sidfoten visar faktiskt läge (på, av, reserv, paus, kostnadsgräns, kvot).
- Turen och syntesen: turen är liten (2 500 token, omtag 4 000 bara efter avkortning) och ställer en fråga; syntesen
  körs en gång efter avslutet (12 000 token, omtag 16 000) under ett eget lås (`/api/granska`, 300 s i testläget) och
  skrivs om bara på begäran (`{igen:true}`) när kunden ändrat något. Misslyckas syntesen stannar ärendet i avslut med
  svaren orörda och kunden kan försöka igen; efter tre fel sammanställs kundens svar deterministiskt (reserv), så att
  granskningen alltid nås. Gateway-syntes på Vercel skulle slå i funktionstiden (60 s) och falla till reserven; vägen
  är ändå avstängd. Kundens eget avslut (`/api/avsluta`) låter intervjuaren avrunda med ett turanrop.
- Kvot (testläget): ett kvotbesked från `claude -p` ("You've hit your session limit", "You've reached your Opus limit")
  klassas per modell och ger ingen tiominuterspaus; turen faller till standardlistan och sidfoten säger "AI-stöd:
  kvoten för <modell> är slut … Byt modell med /model". Nästa lyckade anrop nollställer beskedet. Kvoten provas bara
  med en falsk `claude`-binär (`tests/core/agent.cjs`), aldrig genom att framkalla gränsen.
- Samtycke: inlämning kräver kundens kryssruta med exakt texten i `lib/samtycke.ts` (`samtycke/1`), bekräftad
  genomläsning och fasen granskning (eller inlamnat med ändringar); annars 422/409. Texten sparas i inlämningen.
- Tillval: kundens val sparas med idempotensnyckel; högst åtta egna behov; texter som ser ut som lösenord vägras. Ett
  val är ett önskemål, inte ett köp, och ändrar inget konto. Digitalas status sätts bara genom intern Bearer.
- Domän: bara offentliga DNS- och RDAP-uppgifter; interna namn (`localhost`, `.local`, `.internal`, `.test`, `.example`,
  `.invalid`, `.arpa`) och IP-adresser vägras. `.se`/`.nu` saknar RDAP i IANA:s bootstrap; där avgörs registreringen ur
  DNS (namnservrar finns = registrerad, NXDOMAIN = troligen ledig, "bekräftas först vid registrering"), annars "Vi kunde
  inte avgöra om … är registrerad". Ingenting ändras hos kundens leverantör.
- Svar: högst 4 000 tecken; texter som ser ut som lösenord eller nycklar vägras och sparas inte.
- Material: 4 MB per fil, 25 filer, 40 MB per ärende, högst 50 poster inklusive länkar, typ ur innehållet; SVG med
  skript vägras; nedladdning bara genom funktionen med `Content-Disposition: attachment`. Länkar sparas som text och
  hämtas aldrig av tjänsten; ansvaret för interna adresser och metadata-endpoints ligger i Digitalas researchväg
  (Runtimes sandlådade profiler), inte här.
- Dubbla svar: samma text igen på samma fråga (annan flik, återförsök) ger ingen ny rad; annan text på en redan besvarad
  fråga blir ett ändrat svar som ersätter det förra synligt. En rättelse i Ditt uppdrag får en ny idempotensnyckel per öppnat
  fält; samma värde igen ger beskedet "Ingen ändring sparades".
- CSP tillåter `script-src 'unsafe-inline'` (Next.js utan nonce); en nonce-lösning bör in före skarp kunddrift.
- Plattform: Vercels Deployment Protection (Vercel Authentication) på förhandsvisningen; Vercel WAF/rate limiting
  kan läggas till per projekt i dashboarden (inte gjort; ingen kund är inbjuden).

## Rörliga kostnader

- AI (driftläget): `openai/gpt-5-mini` genom AI Gateway, listpris 0,25 USD per miljon in-token och 2 USD per miljon
  ut-token (avläst i gatewayn 2026-09-28 17:07Z). Gatewayn returnerar faktisk kostnad per anrop och den bokförs i ärendet
  (`ai.kostnad_usd`) och i månadens reskontra (`GET /api/intern/budget`). Fri nivå: månadens fria kredit (saldo
  4,76 USD 2026-09-28 17:07Z); inga köpta krediter (köp = ägarbeslut). Uppmätt kostnad per agenttur finns i
  uppdragets evidens och ska läsas därifrån, inte uppskattas här.
- AI (lokalt testläge `claude-cli`): körs på ägarens Claude Code-abonnemang och räknas mot dess kvot, inte i USD.
  `claude -p` rapporterar ett listprisvärde (`listpris_usd_ej_kostnad` i händelsen); det är ingen faktisk kostnad.
  Kostnadsspärren gäller inte testläget; gränsen på AI-svar per ärende (`KUNDSTART_AI_MAX_ANROP`) gäller.
- Blob: några kB per ärende plus material; operationer i tiotal per ärende; inom Pro-kreditens ram vid rimlig volym.
- Funktioner: aktiv CPU-tid i millisekunder per anrop; inom Pro-kreditens ram. En agenttur väntar på modellen
  (Fluid compute räknar aktiv CPU, inte väntetid).

## Lägen och vad kunden ser

Alla lägen visar samma fem skärmar (intro, intervju, avslut, granskning, tack); skillnaden är vem som formulerar
frågorna och sammanfattningen.

| Läge | Turen | Avslut och syntes | Vad kunden ser |
|---|---|---|---|
| `claude-cli` (lokalt testläge) | intervjuaren speglar och ställer EN fråga ur guiden, med den Claude-modell och ansträngning ägaren valt i skrivrutan, genom `claude -p` | intervjuaren avrundar (nyckelinsikt, sista tankar); syntesen skriver sammanfattningen och noteringarna med citat, med syntesens eget modellval | "AI-stöd: på, lokalt testläge med Claude (Opus 5.5 · max). …"; "Skriven av AI-stödet utifrån era egna ord"; modellvalet i skrivrutan; vägrar på Vercel |
| `gateway` (avstängt) | som ovan via AI Gateway | som ovan; syntesen ryms sällan i 60 s och faller till reserven | "AI-stöd: på. …" |
| reserv efter fel | standardlistan för den frågan | efter tre syntesfel: deterministisk sammanställning | "AI-stöd: reservläge efter ett fel. …" eller "pausat efter upprepade fel", även efter omladdning |
| kvot slut (testläget) | standardlistan | som reserv | "AI-stöd: kvoten för Opus 5.5 är slut (återställs 14:00). Byt modell med /model; …" |
| kostnadstak nått (gateway) | standardlistan | reserv | "AI-stöd: pausat (ärendets budget för AI-stödet är förbrukad)" / "(dagens …)" / "(månadens …)" |
| `regelstyrd` | följdfrågor först, sedan luckor i prioritetsordning, "Fråga 3 av ungefär 14"; avrundar med fast text | kundens svar sammanställs ordagrant under bankens rubriker | "AI-stöd: av. Frågorna följer vår standardlista och sammanfattningen är en sammanställning av era egna svar." |
| ärendets läge tillåts inte i miljön | regelstyrd, utan felmeddelande (t.ex. ett äldre gateway-ärende i produktionen efter 2026-09-29) | som regelstyrd | som regelstyrd |

## Lokalt testläge (som förbättringspartnern)

Kör från primärutcheckningen på main och starta om efter varje sammanfogning:

```sh
npm run prov -- start     # bygger om vid behov, kör next start på 127.0.0.1:3131 med KUNDSTART_AI=claude-cli
npm run prov -- oppna     # öppnar ägarens provärende (länken sparas 0600 i ~/.nortropic-hemligheter/kundstart/); --ny skapar ett nytt
npm run prov -- status    # kör den, vilken kod, vilket modellval
npm run prov -- stopp
```

I skrivrutan väljs turens modell (Opus 5.5, Fable 5.1, Sonnet 5, Opus 5, Haiku 4.5) och ansträngning (low–max), som i
förbättringspartnern; `/model sonnet` och `/effort high` i rutan byter direkt och skickas aldrig som svar. Valet gäller
från nästa fråga och sparas i `installningar.json` (0600). Syntesen har ett eget val i samma fil (`syntes_modell`,
`syntes_anstrangning`; sätts med `POST /api/prov/installningar {syntes:{…}}`). Standard är Opus 5.5 på max för både
turen och syntesen (ägarens beslut 2026-10-01). Känns turerna långsamma: `/effort low` eller `/model sonnet`. `npm run prov -- oppna --ny` skapar ett ärende som börjar på startskärmen; det befintliga
provärendet härleder sin fas ur det som finns (ingen migrering). `node scripts/modellprov.cjs` kör turens och
syntesens prompter mot riktig modell utan webbläsare och skriver tid, cacheträffar och validerad utdata. Ett ärende som skapats i testläget har läget `claude-cli`;
öppnas det på en server utan testläget får det standardlistan. Testläget är bara för ägarens egna prov: Anthropics
villkor för Claude Code tillåter inte att en Pro- eller Max-inloggning svarar någon annans användare.

## Återställning och radering

Ärendet är ett dokument (`arenden/<id>.json`) plus material (`material/<id>/…`) och länkar (`lankar/<hash>.json`).
Radering på kundens begäran: ta bort dokument och filer i Blob-lagret (`vercel blob del`) efter att exporten hämtats till
kundmappen. Ingen automatisk gallring är inbyggd; bestäm bevarandetid i beställningen.

## Kandidatens nya kontrakt

Se [KUNDSTART-KONTRAKT.md](KUNDSTART-KONTRAKT.md). Föregående kostnadsuppskattning baserades på den äldre tokenbudgeten och är historisk; den bevisar ingen kostnad för den nya kandidaten. Modellen och befintligt konto behålls, inga köpta krediter tillförs.

Avläsning 2026-09-28: källkandidat `defcbacc` används på den legitima kundaliasen. En faktisk
kundrevision är importerad och fjärrkvitterad genom Digitalas ordinarie konsument. Två nya
verkliga 60-sekunders schemastarter på RTac5/Office58/Digitala d611 gav därefter inget nytt,
med oförändrad kundakt; detta är temporär kandidatkvalificering, inte aktiv Runtime-drift.
Senare dokumentkontinuitet 2026-09-28 efter r4: deployment och intagsbevis är inte main-integration. Den föregående dokumentkandidaten
`c2b68d7` publicerades som privat källgren och återlästes; detta är ett daterat utfall, inte
denna senare dokumentnots nya head. Privat reposkydd och draft har fortsatt planhinder;
ingen synlighets-/planändring eller main-integration är genomförd. Kontorets gällande plan
äger nästa införandesteg. `atgarder/intag-20260927` bevaras som exakt gransknings-/deploybaslinje;
den publicerade `atgarder/dokumentkontinuitet-20260928` tillför enbart denna faktanot och
är inte den tidigare koddomens exakta SHA. Senaste dokumentpublicering binds separat i
kontorets privata `drift/plan-kontinuitet-efter-r4/PUBLICERING-EFTER-R4.json` när den är gjord;
kontorets plan äger fortsatt nästa handling, leveransbeskedet är daterade fakta.

## Låst driftsättningskommando (OVL-20260930-dbbdd8 B5)

Vercel CLI **60.0.1**, samma version som den befintliga globala installationen vid
avläsningen 2026-09-30, låses separat i `verktyg/vercel-cli/package.json` och dess
låsfil med npm-integritet. Installera från primärutcheckningen:

```sh
npm ci --prefix verktyg/vercel-cli --ignore-scripts
python3 -I -B scripts/vercel_las.py --kontrollera
# Endast vid ett uppdrag som namnger driftsättning:
python3 -I -B scripts/vercel_las.py deploy --prod
```

Vakten kräver den kvalificerade Mac/arm64-miljön, ren primärutcheckning på `main`
och samma revision som lokalt återlästa `origin/main`. Den verifierar SHA-256 för
CLI-manifestet, låsfilen och Vercels kompletta bundlade native-binär innan någon
leverantörskod eller autentisering startar. Binärens hash har jämförts med medlemmen
`package/bin/vercel` i npm-arkivet vars SHA-512 stämmer med låsfilens integritet.
Symlänkar och grupp-/världsskrivbar binär vägras. Ingen global CLI eller ändringsbar
JavaScript-importkedja används. Linux/annan arkitektur kräver egen kvalificering.

Detta byter den lokala kommandovägen; enbart versions- och vägransprov körs i denna
beställning, ingen driftsättning. Den globala installationen och produktionen
ändras inte. En ny CLI-version kräver nytt manifest/lås, uppmätta hashvärden i
vakten, granskning och skyddad integration. Uppdatera inte hashvärden för att passera
ett oväntat fel. Den tidigare `vercel deploy --prod` ersätts av kommandot ovan.
