# nortropic-kundstart — Digitala Kundstart

Kundlänken för Digitalas intervju och materialinlämning: ett lugnt samtal på webben där kunden berättar, kompletterar
och rättar vår förståelse, i sin egen takt och på mobilen. Kundstart är **kundytan**; intervjulogiken, research.md,
briefen och kedjan bor i `Nortropic/nortropic-digitala` (steget `intervju`, `verktyg/intervju.py`). Kundstart är en
kanal i den modellen ("Kundstart-länk"), inte en egen intervjumotor och inte en andra sanning om kunden.

## Tre moment

1. **Börja eller fortsätt** — kunden öppnar sin personliga länk och fortsätter där den var. Första frågan är fast
   ("Berätta med egna ord …") så att ingen väntar på en modell innan samtalet börjat.
2. **Samtalet** — en sammanhållen intervjuagent ställer en fråga i taget, formulerar egna följdfrågor och kan notera
   flera behov ur ett och samma svar. Frågebanken är agentens täckningsstöd, inte ett manus. "Vet inte", "gäller inte",
   "avstår" och "återkom senare" är riktiga svar som hålls isär. Tillval kan väljas direkt i samtalet.
3. **Ditt uppdrag** — samma ärende som översikt: mål, det vi förstått (kundens ord skilda från AI-stödets tolkningar),
   valda och rekommenderade tillval, material med lässtatus, det som återstår och det Digitala själva ska undersöka.
   Allt går att rätta här eller i samtalet. På stor skärm står översikten bredvid samtalet, på mobil öppnas den som ett
   ark från sidhuvudet. Inlämning bekräftar vad som lämnats, utan design- eller avtalsgodkännande.

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
- **Intervjuagenten** (`lib/agent.ts`, körs från `nasta()` i `lib/arende.ts`) får ärendets kända uppgifter, täckning,
  tillval och senaste svar, och svarar med ett strikt JSON-schema: nästa fråga plus ett fåtal "verktyg" som strukturerade
  listor (`notera_uppgift`, `notera_behov`, `satt_tillval`, `rekommendera_tillval`, `markera_tackning`,
  `bestall_research`). Servern tilldelar alla id, kräver att varje notering citerar kundens ord ordagrant ur ett namngivet
  svar eller material, och avvisar resten synligt i händelseloggen. En modellrespons som kommer efter en nyare ändring
  (svar, rättelse, tillvalsval) kasseras; kundens senaste ord vinner. Ingen HTML eller kod från modellen körs hos kunden.
- **Tillval** (`lib/tillval.ts`): domän, formulär/bilagor, e-postmottagning, bokning, betalning/deposition, CRM,
  nyhetsbrev, CMS, Search Console, Google-företagsprofil, Google Ads, Meta-annonser och analys, plus kundens egna behov.
  Kundens val (vill ha / har redan ett system / hjälp att välja / inte nu), Digitalas rekommendation och Digitalas
  status (ingår / väntar på åtkomst / anslutet och prövat) hålls isär. Ett val köper ingenting, ändrar inget konto och
  aktiverar inga annonser. Priser visas bara när de är verifierade med källa och datum.
- **Domänflödet** (`lib/doman.ts`): kunden anger en befintlig domän eller ett önskemål; servern läser offentliga
  DNS-uppgifter (DoH) och registerdata (RDAP via IANA:s bootstrap), följer aldrig omdirigeringar och vägrar interna namn.
  Ingenting ändras hos kundens leverantör.
- **Kostnadsspärr** (`lib/budget.ts`): varje modellanrop reserverar sin högsta möjliga kostnad mot ärendets, dygnets och
  månadens tak i en villkorad Blob-skrivning innan anropet görs, och avräknas mot gatewayns faktiska kostnad efteråt.
  Når ett tak tar den regelstyrda vägen över och kunden ser det.
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
npm install
vercel env pull .env.local        # Blob-token, OIDC, KUNDSTART_HEMLIGHET, KUNDSTART_INTERN_NYCKEL
npm run build && KUNDSTART_AI=regelstyrd npx next start -H 127.0.0.1 -p 3111
npm run test:e2e                  # Playwright mot 127.0.0.1:3111 (startar servern själv om ingen kör)
```

`KUNDSTART_AI` = `gateway` (Vercel AI Gateway, driftläget), `regelstyrd` (ingen modell; frågorna följer bankens ordning)
eller `claude-cli` (lokalt testläge: agenten körs genom `claude -p` på byggmaskinens Claude Code-inloggning, isolerat från
minne, CLAUDE.md, MCP och verktyg; standardmodell `claude-opus-5` med `--effort low`; vägrar på Vercel och är inte en
kommersiell väg).

```sh
npm run test:core                 # agent, kostnadsspärr, domän, tillval, CAS (utan nätverk utom märkta prov)
KUNDSTART_AI=claude-cli npx playwright test tests/ai.spec.ts   # verklig modelltur lokalt (servern startas i samma läge)
```

## Överlämning och åtgärdskontrakt

[KUNDSTART-KONTRAKT.md](KUNDSTART-KONTRAKT.md) beskriver den beständiga revisionssignalen, intern kvittens, returfrågor, materialets lässtatus och AI-felklasser. Signalen är en del av befintligt ärende; faktisk schemalagd import verifieras i Digitala/Runtime. G01:s legitima hostade kundåtkomst är en separat driftskonfiguration och bevisas inte av intern Vercel-bypass.
