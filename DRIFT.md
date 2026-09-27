# Drift — Kundstart

Läst mot Vercels dokumentation 2026-09-27 (AI Gateway pricing/authentication/OIDC, Vercel Blob, Functions limits).

## Var tjänsten kör

| Del | Var | Anmärkning |
|---|---|---|
| Webb och API | Vercel, team `nortropic` (Pro), projekt `nortropic-kundstart`, funktioner i `arn1` (Stockholm) | `vercel.json` sätter regionen; Fluid compute, standardkostnad inom Pro-krediten |
| Dokument och filer | Vercel Blob, lagret `nortropic-kundstart` (privat, region `arn1`) | OIDC på Vercel, `BLOB_READ_WRITE_TOKEN` lokalt; storlek och operationer räknas mot Pro-krediten |
| Modell | Vercel AI Gateway (`https://ai-gateway.vercel.sh`), OIDC-token från deploymenten, ingen API-nyckel | fri nivå: `openai/gpt-5-mini` (standard), `openai/gpt-4.1-mini`; Claude-modeller kräver köpta AI Gateway-krediter (403 `RestrictedModelsError` på fri nivå, uppmätt 2026-09-27 14:42Z) |
| Byggsession | ägarens Mac | inget av ovanstående beror på den; kunden kan svara när Macen sover |

## Miljövariabler

| Namn | Var | Vad |
|---|---|---|
| `KUNDSTART_HEMLIGHET` | Vercel (prod/preview sensitive, dev), 0600-kopia i `~/.nortropic-hemligheter/kundstart/` | signerar sessionskakan |
| `KUNDSTART_INTERN_NYCKEL` | samma | Bearer för `/api/intern/*` (Digitalas `verktyg/kundstart.py`) |
| `KUNDSTART_AI` | Vercel | `gateway` (standard på Vercel) · `regelstyrd` · `claude-cli` (bara lokalt) |
| `KUNDSTART_AI_MODELL` | Vercel | standard `openai/gpt-5-mini`; `anthropic/claude-haiku-4.5` när krediter finns |
| `KUNDSTART_AI_MAX_ANROP` | Vercel | AI-anrop per ärende (standard 60) |
| `AI_GATEWAY_API_KEY` | valfri | ersätter OIDC (t.ex. kör utanför Vercel) |
| `BLOB_READ_WRITE_TOKEN`, `VERCEL_OIDC_TOKEN`, `BLOB_STORE_ID` | av Vercel | lagrets åtkomst |

## Gränser och missbruksskydd (serversidan)

- Länk: 256 bitar, hash i lagret, giltig 30 dagar (styrbart), återkallbar; kakan signerad, httpOnly, 30 dagar; alla
  kund-API:er kräver giltig kaka *och* giltig länk vid varje anrop.
- AI: högst `KUNDSTART_AI_MAX_ANROP` anrop per ärende; efter tre fel i rad (räknaren nollställs vid lyckat anrop)
  pausas AI-stödet i tio minuter (regelstyrd väg tar över, kunden ser det); gatewayanrop tar högst25s och har högst två försök; modellens svar
  valideras mot kandidatlistan och längdgränser. Fri text från kunden startar aldrig research, verktygsloopar eller
  webbhämtning. Sidfoten visar faktisk aktuell AI-/reserv-/pausstatus; senaste svarande modell anges bara som kontext.
- Svar: högst 4 000 tecken; texter som ser ut som lösenord eller nycklar vägras och sparas inte.
- Material: 4 MB per fil, 25 filer, 40 MB per ärende, högst 50 poster inklusive länkar, typ ur innehållet; SVG med
  skript vägras; nedladdning bara genom funktionen med `Content-Disposition: attachment`. Länkar sparas som text och
  hämtas aldrig av tjänsten; ansvaret för interna adresser och metadata-endpoints ligger i Digitalas researchväg
  (Runtimes sandlådade profiler), inte här.
- Dubbla svar: samma text igen på samma fråga (annan flik, återförsök) ger ingen ny rad; annan text på en redan besvarad
  fråga blir ett ändrat svar som ersätter det förra synligt. En rättelse i Vår bild får en ny idempotensnyckel per öppnat
  fält; samma värde igen ger beskedet "Ingen ändring sparades".
- CSP tillåter `script-src 'unsafe-inline'` (Next.js utan nonce); en nonce-lösning bör in före skarp kunddrift.
- Plattform: Vercels Deployment Protection (Vercel Authentication) på förhandsvisningen; Vercel WAF/rate limiting
  kan läggas till per projekt i dashboarden (inte gjort; ingen kund är inbjuden).

## Rörliga kostnader (uppskattning, listpriser 2026-09-27)

- AI: `gpt-5-mini` ≈ 0,0005 USD per anrop (uppmätt 372 tokens); en genomgång med 30 anrop ≈ 0,015 USD. Fri nivå:
  månatlig fri kredit, lägre hastighetsgränser; inga köpta krediter (köp = ägarbeslut). `claude-haiku-4.5` ≈ 0,001–0,004
  USD per anrop när krediter finns.
- Blob: några kB per ärende plus material; operationer i tiotal per ärende; inom Pro-kreditens ram vid rimlig volym.
- Funktioner: aktiv CPU-tid i millisekunder per anrop; inom Pro-kreditens ram.

## Lägen och vad kunden ser

| Läge | Hur nästa fråga väljs | Vad kunden ser |
|---|---|---|
| `gateway` | modellen väljer bland kandidaterna, omformulerar, markerar täckta frågor, håller bilden | "AI-stöd: tillgängligt (modell)"; AI:ns tolkningar märkta i Vår bild |
| fallback vid fel | regelstyrd för den frågan | "AI-stöd: reservläge efter ett fel" eller "AI-stöd: pausat", även efter omladdning |
| `regelstyrd` | följdfrågor först, sedan luckor i prioritetsordning | "AI-stöd: av. Frågorna följer vår standardlista." |

## Återställning och radering

Ärendet är ett dokument (`arenden/<id>.json`) plus material (`material/<id>/…`) och länkar (`lankar/<hash>.json`).
Radering på kundens begäran: ta bort dokument och filer i Blob-lagret (`vercel blob del`) efter att exporten hämtats till
kundmappen. Ingen automatisk gallring är inbyggd; bestäm bevarandetid i beställningen.

## Kandidatens nya kontrakt

Se [KUNDSTART-KONTRAKT.md](KUNDSTART-KONTRAKT.md). Föregående kostnadsuppskattning baserades på den äldre tokenbudgeten och är historisk; den bevisar ingen kostnad för den nya kandidaten. Modellen och befintligt konto behålls, inga köpta krediter tillförs.
