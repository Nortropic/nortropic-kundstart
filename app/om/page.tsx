import { gatewayPa, standardModell } from '@/lib/arende';
import { provTillatet } from '@/lib/provlage';

// Texten följer serverns faktiska läge vid varje visning (miljövariabler vid körning, inte vid bygget).
export const dynamic = 'force-dynamic';

/** Modellens namn för kunden, ur den konfigurerade standardmodellen (KUNDSTART_AI_MODELL). */
const MODELLNAMN: Record<string, string> = {
  'openai/gpt-5-mini': 'OpenAI GPT-5 mini',
  'openai/gpt-4.1-mini': 'OpenAI GPT-4.1 mini',
  'anthropic/claude-haiku-4.5': 'Anthropic Claude Haiku 4.5',
};
const LEVERANTORER: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', mistral: 'Mistral' };
function modellNamn(id: string): string {
  return MODELLNAMN[id] || `en modell från ${LEVERANTORER[id.split('/')[0]] || id.split('/')[0]}`;
}

export default function Om() {
  return (
    <main className="ram">
      <header className="huvud">
        <span className="ord">Nortropic<small>Digitala</small></span>
      </header>
      <h1>Så behandlar vi det ni lämnar</h1>
      <p>Det ni skriver och laddar upp i Kundstart används för ert uppdrag hos Nortropic: för att förstå er verksamhet och bygga rätt lösning. Uppgifterna sparas privat hos vår driftleverantör i Stockholmsregionen och flyttas till ert uppdrags underlag hos Nortropic.</p>
      {gatewayPa() ? (
        <p>Ett AI-stöd ställer följdfrågor och sammanfattar vad ni sagt i Ditt uppdrag. För det skickas det ni skrivit i ärendet, och text ur material ni lämnat, till en språkmodell ({modellNamn(standardModell())}) genom vår driftleverantörs AI-tjänst (Vercel AI Gateway). AI-stödet ser bara det som hör till ert ärende. Era egna ord sparas alltid ordagrant och skilt från sammanfattningen, och ni kan rätta vår förståelse när som helst.</p>
      ) : provTillatet() ? (
        <p>Det här är Nortropics lokala testläge, som bara används för Nortropics egna prov. Ett AI-stöd ställer följdfrågor och sammanfattar i Ditt uppdrag; det ni skriver i ärendet skickas till en Claude-modell från Anthropic genom Claude Code på Nortropics egen dator. Era egna ord sparas alltid ordagrant och skilt från sammanfattningen, och ni kan rätta förståelsen när som helst.</p>
      ) : (
        <p>Just nu används inget AI-stöd: frågorna följer vår standardlista, och det ni skriver skickas inte till någon språkmodell. Era egna ord sparas ordagrant och samlas i Ditt uppdrag, där ni kan rätta vår förståelse när som helst.</p>
      )}
      <p>Anger ni en domän kontrollerar vi offentliga uppgifter om den (DNS och domänregistret). Ingenting ändras hos er leverantör. Att välja ett tillval betyder att ni vill att vi tar med det i uppdraget; ingenting köps, inget konto ändras och inga annonser startas från den här sidan.</p>
      <p>Lämna inga lösenord eller nycklar här; åtkomst till system ordnar vi på säker väg. Vill ni att något tas bort, hör av er till er kontakt hos Nortropic.</p>
    </main>
  );
}
