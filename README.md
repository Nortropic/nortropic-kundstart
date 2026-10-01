# nortropic-kundstart — Digitala Kundstart

Kundlänken för Digitalas intervju och materialinlämning: en intervju på webben i Anthropic Interviewers format, där
kunden berättar i sin egen takt (gärna på mobilen), läser igenom vår sammanfattning och bestämmer själv om den ska
lämnas vidare. Kundstart är **kundytan**; intervjulogiken, research.md,
briefen och kedjan bor i `Nortropic/nortropic-digitala` (steget `intervju`, `verktyg/intervju.py`). Kundstart är en
kanal i den modellen ("Kundstart-länk"), inte en egen intervjumotor och inte en andra sanning om kunden.

## Fem faser

1. **Intro** — startskärmen säger vad intervjun är, att den tar ungefär 15 minuter och att kunden efteråt läser igenom
   och bestämmer själv. "Börja intervjun" ställer den fasta öppningsfrågan ("Berätta med egna ord …") utan att vänta på
   någon modell; "Inte nu" sparar ingenting och länken fungerar senare.
2. **Intervjun** — en enda tråd: intervjuaren speglar det kunden sagt och ställer EN öppen fråga i taget; kunden svarar
   i en skrivruta. Inga paneler, flervalsknappar eller kort. Frågebanken är intervjuguiden (områden, prioritet,
   exempelformuleringar), inte ett manus. "Vet inte", "gäller inte oss" och "återkom" sägs i ord; ett helt
   "vet inte"-svar sparas som ett ärligt okänt. Kunden kan avsluta själv när som helst.
3. **Avslut** — intervjuaren rundar av (en nyckelinsikt, det kunden själv lyft) och bjuder in sista tankar; kunden kan
   gå vidare eller berätta mer.
4. **Granskning** — sammanfattningen ("så här förstod vi er"), översikten "Det vi har förstått" med rättelser (tillval och
   material som valfria, infällda avsnitt), hela intervjun ordagrant och samtycket: kryssrutan "Jag har läst igenom min
   intervju och vill lämna den vidare till Nortropic" låses upp när slutet av intervjun nåtts, och servern kräver exakt
   den texten och rätt fas. Inlämning godkänner ingen design, inget köp och inget avtal.
5. **Tack** — vad som lämnats och vad som händer nu. Det inlämnade kan visas igen; nya svar efter inlämningen syns som
   ändringar och lämnas in på nytt.

## Hur det hänger ihop

```
Digitala (kundmappen, INTERVJU.json)  ── verktyg/kundstart.py skapa ──▶  Kundstart: ärende + inbjudningslänk
                                                                          kunden svarar, rättar, lämnar material
Digitala (kundmappen, INTERVJU.json)  ◀── verktyg/kundstart.py hamta ──  export (kundstart-export/1): svar ordagrant,
                                          (eller konsumera)               rättelser, kunduppgifter med citat, tillval,
                                                                          research-beställningar, AI-tolkningar som fakta
                                                                          'tolkning', material med sha256
```

- **Frågebanken** är en snapshot av `GRUND`, `FOLJDREGLER` m.m. ur `nortropic-digitala/verktyg/intervju.py`
  (`intervju-bank.json`, med filens sha256 och git-revision). `verktyg/bank_snapshot.py` tar den, `verktyg/bank_kontroll.mjs`
  visar drift. Banken är stöd; källbundna behov och revisionsbundna returfrågor kan tillkomma i samma ärende. Se KUNDSTART-KONTRAKT.md.
- **Intervjuaren** (`lib/agent.ts`, körs från `nasta()` och `syntes()` i `lib/arende.ts`) arbetar i två kontrakt, som
  Anthropic Interviewers planering → intervju → analys. **Turen** får en slank kontext (samtalet, täckning, utlösta och
  negerade följdämnen, öppna behov) och svarar med ett litet strikt JSON-schema: återkoppling, EN öppen fråga ur guiden,
  berörda nycklar och om den vill runda av. **Syntesen** körs en gång efter avslutet med hela intervjun och material, och
  svarar med sammanfattningen till kunden plus noteringarna (`uppgifter`, `behov`, `tillval`, `tackning`, `research`).
  Reglerna och intervjuguiden (genererad ur banken) ligger i statiska systemprompter, så modellens promptcache kan träffa
  mellan turer. Servern tilldelar alla id, kräver att varje notering citerar kundens ord ordagrant ur ett namngivet svar
  eller material, och avvisar resten synligt i händelseloggen. Ett tillval blir kundens val bara när kundens eget citat
  bär det; utan citat kan det bara bli en rekommendation. Ett negerat följdämne som inte är utlöst får inte tas upp
  (NEGATION-regeln speglas av servern). En modellrespons som kommer efter en nyare ändring kasseras; kundens senaste ord
  vinner. Avrundning godtas när inga viktiga områden står orörda och minst sex frågor ställts, eller efter fjorton; samma
  regel gäller standardlistan. Ingen HTML eller kod från modellen körs hos kunden.
  Sedan 2026-09-29 (ägarens besked: bara prov nu, ingen kostnads-AI) körs intervjuaren bara i det lokala testläget på
  ägarens dator, med Claude Code på ägarens inloggning som förbättringspartnern. Produktionen ställer standardlistans
  frågor och sammanställer kundens egna svar ordagrant utan modell.
- **Tillval** (`lib/tillval.ts`): domän, formulär/bilagor, e-postmottagning, bokning, betalning/deposition, CRM,
  nyhetsbrev, CMS, Search Console, Google-företagsprofil, Google Ads, Meta-annonser och analys, plus kundens egna behov.
  Kundens val (vill ha / har redan ett system / hjälp att välja / inte nu), Digitalas rekommendation och Digitalas
  status (ingår / väntar på åtkomst / anslutet och prövat) hålls isär. Ett val köper ingenting, ändrar inget konto och
  aktiverar inga annonser. Priser visas bara när de är verifierade med källa och datum.
- **Domänflödet** (`lib/doman.ts`): kunden anger en befintlig domän eller ett önskemål; servern läser offentliga
  DNS-uppgifter (DoH) och registerdata (RDAP via IANA:s bootstrap), följer aldrig omdirigeringar och vägrar interna namn.
  Ingenting ändras hos kundens leverantör.
- **Kostnadsspärr** (`lib/budget.ts`, gäller gateway-vägen, avstängd sedan 2026-09-29): varje modellanrop reserverar sin
  högsta möjliga kostnad mot ärendets, dygnets och månadens tak i en villkorad Blob-skrivning innan anropet görs, och
  avräknas mot gatewayns faktiska kostnad efteråt. Når ett tak tar den regelstyrda vägen över och kunden ser det.
- **Lagring** (`lib/lagring.ts`): privata JSON-dokument och filer i Vercel Blob (region Stockholm), villkorad skrivning
  med ETag och omförsök; idempotensnycklar och innehållsregler (samma text på samma fråga, samma fil enligt sha256)
  gör omladdning, dubbelklick, två flikar och återförsök ofarliga.
- **Åtkomst** (`lib/atkomst.ts`): 256 bitars länknyckel i URL-fragmentet (`/start#…`, når aldrig serverloggar), bara
  hashen lagras; första besöket byter nyckeln mot en signerad httpOnly-kaka (30 dagar); länken kan gå ut och återkallas
  från Digitala; ett synligt ärende-id är aldrig behörighet. Intern nyckel (Bearer) för Digitalas verktyg.
- **Material** (`lib/material.ts`): typ avgörs ur innehållet (magiska byte), 4 MB per fil (funktionens kroppsgräns),
  privat lagring, nedladdning bara genom vår funktion och bara för rätt ärende. Länkar sparas men hämtas aldrig av
  servern (ingen SSRF-yta); research läser dem i Digitalas egen väg.

## Drift

Se `DRIFT.md`: Vercel-projektet `nortropic-kundstart` (team nortropic), Blob-lagret `nortropic-kundstart` (privat, arn1),
miljövariabler, AI-läge, gränser och kostnader.

## Kör lokalt

```sh
npm ci
vercel env pull .env.local        # Blob-token, OIDC, KUNDSTART_HEMLIGHET, KUNDSTART_INTERN_NYCKEL
npm run build && KUNDSTART_AI=regelstyrd npx next start -H 127.0.0.1 -p 3111
npm run test:e2e                  # Playwright mot 127.0.0.1:3111 (startar servern själv om ingen kör)
```

`KUNDSTART_AI` = ej satt eller `regelstyrd` (ingen modell; frågorna följer bankens ordning; standard överallt sedan
2026-09-29), `gateway` (Vercel AI Gateway; avstängt tills det uttryckligen slås på) eller `claude-cli` (lokalt testläge:
agenten körs genom `claude -p` på ägarens Claude Code-inloggning, isolerat från minne, CLAUDE.md, MCP och verktyg, med
den modell och ansträngning som väljs i skrivrutan; vägrar på Vercel och är bara för ägarens egna prov).

Testläget körs som förbättringspartnern:

```sh
npm run prov -- start     # 127.0.0.1:3131, bygger om vid behov
npm run prov -- oppna     # öppnar ägarens provärende (--ny skapar ett nytt)
npm run prov -- status
npm run prov -- stopp
```

```sh
npm run test:core                 # fasmaskinen, intervjuaren (tur + syntes), kostnadsspärr, domän, tillval, CAS (utan nätverk)
KUNDSTART_AI=claude-cli KUNDSTART_AVSLUT_EFTER_FRAGOR=3 npx playwright test tests/ai.spec.ts tests/provlage.spec.ts   # hel intervju mot riktig modell på 3111
node scripts/modellprov.cjs --model claude-opus-5-5 --effort low   # turens och syntesens prompter mot riktig modell, utan webbläsare
```

Förbrukningen i testläget räknas i abonnemangets kvot (en modellsession per tur och en per syntes), inte i USD. Tar en
modells kvot slut säger sidfoten det och botemedlet är `/model`: turerna faller till standardlistan tills dess.

## Överlämning och åtgärdskontrakt

[KUNDSTART-KONTRAKT.md](KUNDSTART-KONTRAKT.md) beskriver den beständiga revisionssignalen, intern kvittens, returfrågor, materialets lässtatus och AI-felklasser. Signalen är en del av befintligt ärende; faktisk schemalagd import verifieras i Digitala/Runtime. G01:s legitima hostade kundåtkomst är en separat driftskonfiguration och bevisas inte av intern Vercel-bypass.

## Beroenden och leveranskedja

`OVL-20260930-dbbdd8` B1–B5 låser befintliga direkta versioner och Vercel CLI.
`.npmrc` stänger installationsskript; använd `npm ci`, också i CI och värdens bygge.
Kör `npm run kontroll:lasfil`, `npm run test:leveranskedja` och `npm run kontroll:audit`
före lint, typecheck, kärnprov och bygge. Ett uppslagsfel är **kunde inte kontrolleras**
och stoppar; höga/kritiska sårbarheter och alla rapporter om skadlig kod stoppar.
Varningar under hög nivå visas för bedömning. Automatisk uppgradering ingår inte.

En PR som ändrar `package.json` eller `package-lock.json` ska redovisa maskinens
paketlista från `node scripts/lasfil.mjs --bas <basens fulla commit>` och ett daterat
uppslag i [GitHubs säkerhetsdatabas](https://github.com/advisories) för varje nytt paket.
Listan innehåller namn, version och installationsskript, även ändring med samma version.
CI beräknar listan mot PR:ens bas (push mot föregående commit). `unrs-resolver` är
enda tillåtna installationsskriptmarkeringen i applikationslåset; skriptet körs ändå inte.
Vercel CLI har en separat låsfil och installeras alltid med `--ignore-scripts`; se DRIFT.md.


### Sju dagars karenstid före paketkod (f00327 L3)

`npm run kontroll:lasfil` jämför med exakt avläst `origin/main`; CI lämnar sin
bascommit med `--bas`. Varje ny/ändrad låsfilspost får versionens publiceringstid
från npm-registrets fullständiga paketmetadata. Före sju hela dygn stoppas den.
Fel, saknad tid, fel paket, redirect, svar över 64 MiB eller tio sekunders timeout
blir **kunde inte kontrolleras** och stoppar även med undantag. Registrets svar
kör ingen paketkod. Npm-alias vars verkliga paketnamn skiljer sig från installationsnamnet vägras
före uppslag och undantag; inget annat pakets ålder kan lånas.
Oförändrade paket ger inga nya uppslag. Inga npm-inställningar
för releaseålder används.

`paketundantag.json` har schema 1 och listan `undantag`. Varje granskad undantagsrad
kräver `paket`, exakt `version`, `skal` och `datum` (ÅÅÅÅ-MM-DD). Den står vid paketet
i den maskinella ändringslistan, även när paketet är gammalt nog. Filen har inga
undantag vid införandet. Datum i framtiden och dubbla rader vägras.

Lokalt före driftsättning: hämta `origin/main`, kör `npm run kontroll:lasfil` **före**
`npm ci`, leveranskedjeprov, audit, lint, typecheck, kärnprov och bygge. CI följer
samma ordning; `npm run prov -- start` kontrollerar också låsfil/karenstid innan
sitt lokala bygge. Det här steget startar eller driftsätter ingenting självt.
Källa för metadata: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md
(läst 2026-09-30), med `time[version]` i fullmetadata.
