# nortropic-kundstart — Digitala Kundstart

Kundlänken för Digitalas intervju och materialinlämning: ett lugnt samtal på webben där kunden berättar, kompletterar
och rättar vår förståelse, i sin egen takt och på mobilen. Kundstart är **kundytan**; intervjulogiken, research.md,
briefen och kedjan bor i `Nortropic/nortropic-digitala` (steget `intervju`, `verktyg/intervju.py`). Kundstart är en
kanal i den modellen ("Kundstart-länk"), inte en egen intervjumotor och inte en andra sanning om kunden.

## Tre moment

1. **Börja eller fortsätt** — kunden öppnar sin personliga länk, ser vad genomgången är till för och vad vi redan vet
   (förifyllda uppgifter med källa), och fortsätter där den var.
2. **Berätta och komplettera** — en fråga i taget ur Digitalas frågebank; följdfrågor beror på svaren (regler ur
   `intervju.py`, eller AI-stödet när det är på); "vet inte" och "återkom senare" är riktiga svar; material som fil
   eller länk.
3. **Se och rätta förståelsen** — vår bild av kunden: kundens egna ord, öppna källbundna behov, AI:ns tolkningar (märkta) och det förifyllda,
   allt möjligt att rätta. Inlämning bekräftar vad som lämnats och vad som händer, utan design- eller avtalsgodkännande.

## Hur det hänger ihop

```
Digitala (kundmappen, INTERVJU.json)  ── verktyg/kundstart.py skapa ──▶  Kundstart: ärende + inbjudningslänk
                                                                          kunden svarar, rättar, lämnar material
Digitala (kundmappen, INTERVJU.json)  ◀── verktyg/kundstart.py hamta ──  export (kundstart-export/1): svar ordagrant,
                                                                          rättelser, AI-tolkningar som fakta 'tolkning',
                                                                          material med sha256
```

- **Frågebanken** är en snapshot av `GRUND`, `FOLJDREGLER` m.m. ur `nortropic-digitala/verktyg/intervju.py`
  (`intervju-bank.json`, med filens sha256 och git-revision). `verktyg/bank_snapshot.py` tar den, `verktyg/bank_kontroll.mjs`
  visar drift. Banken är stöd; källbundna behov och revisionsbundna returfrågor kan tillkomma i samma ärende. Se KUNDSTART-KONTRAKT.md.
- **Intervjuledaren** (`lib/intervjuledare.ts`) väljer nästa fråga bland kandidaterna (följdfrågor först, sedan luckor i
  prioritetsordning) och avgör vilka kandidater ett öppet svar redan täcker. Modellen får bara returnera strukturerad
  data mot kandidatlistan; id och källcitat valideras på servern, ogiltiga svar faller tillbaka till den regelstyrda vägen. Ingen
  HTML eller kod från modellen körs hos kunden.
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
npm run build && KUNDSTART_AI=regelstyrd npx next start -p 3111
npm run test:e2e                  # Playwright mot 127.0.0.1:3111 (startar servern själv om ingen kör)
```

`KUNDSTART_AI` = `gateway` (Vercel AI Gateway, skarpt läge), `regelstyrd` (ingen modell; frågorna följer bankens ordning)
eller `claude-cli` (bara lokal verifiering i byggmiljön genom `claude -p`; vägrar på Vercel).

## Överlämning och åtgärdskontrakt

[KUNDSTART-KONTRAKT.md](KUNDSTART-KONTRAKT.md) beskriver den beständiga revisionssignalen, intern kvittens, returfrågor, materialets lässtatus och AI-felklasser. Signalen är en del av befintligt ärende; faktisk schemalagd import verifieras i Digitala/Runtime. G01:s legitima hostade kundåtkomst är en separat driftskonfiguration och bevisas inte av intern Vercel-bypass.
