// Tillval: alla integrationsområden som kunden kan upptäcka och välja i verksamhetsord. Katalogen är kundvänd text,
// inte en API-lista. Pris- och leverantörsuppgifter står bara här när de är belagda med källa och datum (Digitalas
// integrationer-standardvagar.md, kontrollerad 2026-09-28, eller leverantörens egen sida läst samma dag); annars står
// uttryckligen att de ännu inte är utredda. Ett tillval är ett önskemål eller en rekommendation, aldrig ett köp,
// en kontoändring eller ett tillstånd att aktivera annonser.
import type { Arende, Tillval, TillvalKundval, TillvalDigitala } from './typer';

export interface TillvalDef {
  id: string;
  grupp: string;
  namn: string;
  kort: string; // vad det gör för verksamheten, en mening
  digitala: string; // vad Digitala kan göra, ärligt avgränsat
  kostnad: string; // belagd uppgift med källa och datum, eller "ännu inte utrett"
  grans: string; // viktig begränsning som kunden ska känna till
}

export const GRUPPER = ['Webbadress', 'Kontakt och förfrågningar', 'Bokning och betalning', 'Kundrelationer', 'Innehåll', 'Synas i Google', 'Annonsering', 'Mätning'] as const;

export const TILLVAL: TillvalDef[] = [
  {
    id: 'doman', grupp: 'Webbadress', namn: 'Egen domän',
    kort: 'Webbplatsen nås på er egen adress, till exempel dittforetag.se, och e-posten på domänen fortsätter fungera.',
    digitala: 'Kontrollerar domänens öppna uppgifter direkt här, kopplar den till webbplatsen vid publiceringen och ser till att e-post och gamla länkar fortsätter fungera. Domänen är och förblir er.',
    kostnad: 'En befintlig domän behåller ni hos er leverantör. Priset för en ny domän beror på ändelse och leverantör och tas fram innan något köps; ännu inte utrett.',
    grans: 'Ingen domän köps och ingenting ändras hos er domänleverantör utan ert godkännande. Att ni anger domänen här publicerar inget.',
  },
  {
    id: 'formular', grupp: 'Kontakt och förfrågningar', namn: 'Formulär och bilagor',
    kort: 'Besökare skickar en förfrågan, gärna med bilder eller dokument, och den når rätt person.',
    digitala: 'Kopplar ert befintliga formulärverktyg eller en etablerad formtjänst till en mottagning med ansvarig person och felväg.',
    kostnad: 'Tally har gratis formulär inom skälig användning; Pro kostar 29 USD/mån (Tallys prislista, kontrollerad 2026-09-28). Ert befintliga verktyg kan ha andra villkor.',
    grans: 'Ett formulär är klart först när ett prov visat att förfrågan kommer fram till rätt mottagare.',
  },
  {
    id: 'epost', grupp: 'Kontakt och förfrågningar', namn: 'E-postmottagning',
    kort: 'Förfrågningar och bekräftelser hamnar i rätt inkorg, också när den som brukar svara är borta.',
    digitala: 'Använder er befintliga e-post; för automatiska bekräftelser kan en prövbar e-posttjänst användas.',
    kostnad: 'Resend Free: 3 000 mejl/mån, 100/dag; Pro från 20 USD/mån (Resends prislista, kontrollerad 2026-09-28).',
    grans: 'Att ett mejl skickats är inte samma sak som att någon har läst det.',
  },
  {
    id: 'bokning', grupp: 'Bokning och betalning', namn: 'Bokning och kalender',
    kort: 'Kunder bokar en tid själva och får bekräftelse, med möjlighet att boka om eller avboka.',
    digitala: 'Väljer lägsta nivå som räcker: länk eller inbäddad vy från en etablerad bokningstjänst, eller er befintliga. Ingen egen bokningsmotor byggs.',
    kostnad: 'Cal.com: gratis för en persons bokningar; fler personers gemensamma kalender kräver betald plan (Teams 12 USD/användare/mån årsvis). SimplyBook.me Free: 50 bokningar/mån, en utförare (prislistor kontrollerade 2026-09-28).',
    grans: 'Delade rum, utrustning eller grupper kräver att reglerna utreds innan en tjänst väljs.',
  },
  {
    id: 'betalning', grupp: 'Bokning och betalning', namn: 'Betalning eller deposition',
    kort: 'Ta betalt eller en deposition i samband med köp eller bokning.',
    digitala: 'Använder i första hand bokningstjänstens egen betalningskoppling; för fristående betalning en betallänk. Kortuppgifter hanteras aldrig av oss.',
    kostnad: 'Stripe: ingen månadsavgift; standardkort i EES 1,5 % + 1,80 kr per betalning, premiumkort 2,8 % + 1,80 kr (Stripes svenska prislista, kontrollerad 2026-09-28).',
    grans: 'En betalning reserverar ingen tid i kalendern; betalning och bokning måste hänga ihop i samma tjänst om båda behövs.',
  },
  {
    id: 'crm', grupp: 'Kundrelationer', namn: 'Kundregister (CRM)',
    kort: 'Förfrågningar förs in i ert kundregister med rätt uppgifter och ansvarig.',
    digitala: 'Förbereder överföring till ert befintliga kundregister och prövar att posten faktiskt kommer fram. Inget nytt CRM byggs.',
    kostnad: 'Beror på ert system; ännu inte utrett.',
    grans: 'En exportfil är inte samma sak som en post som kommit in i ert system.',
  },
  {
    id: 'nyhetsbrev', grupp: 'Kundrelationer', namn: 'Nyhetsbrev',
    kort: 'Besökare kan anmäla sig till ert nyhetsbrev, med tydligt samtycke.',
    digitala: 'Kopplar anmälan till ert befintliga utskicksverktyg eller föreslår ett etablerat, med samtycke och avregistrering.',
    kostnad: 'Beror på verktyg och antal mottagare; ännu inte utrett.',
    grans: 'Befintliga listor får bara användas om samtycket räcker för det nya sammanhanget.',
  },
  {
    id: 'cms', grupp: 'Innehåll', namn: 'Redigera innehållet själva',
    kort: 'Ni ändrar själva texter, bilder, priser och öppettider, med förhandsvisning innan det publiceras.',
    digitala: 'Använder er befintliga plattform eller en vald redaktörsväg och prövar att en ändring kan förhandsvisas, publiceras och återställas.',
    kostnad: 'Beror på plattform; ännu inte utrett.',
    grans: 'Ett verktyg med API är inte samma sak som att er redaktör faktiskt kan göra ändringen.',
  },
  {
    id: 'search_console', grupp: 'Synas i Google', namn: 'Google Search Console',
    kort: 'Se hur ni syns i Googles sökresultat och få varningar när något är fel på webbplatsen.',
    digitala: 'Förbereder verifiering, webbplatskarta och uppföljning. Egendomen är er och kräver er domän och er åtkomst.',
    kostnad: '"Google Search Console is a free service offered by Google" (Googles hjälpsida, läst 2026-09-28).',
    grans: 'Kan kopplas först när webbplatsen ligger på er riktiga domän.',
  },
  {
    id: 'foretagsprofil', grupp: 'Synas i Google', namn: 'Google-företagsprofil',
    kort: 'Visa öppettider, adress, telefon, bilder och omdömen i Google Sök och Maps.',
    digitala: 'Tar fram innehåll och kontroller för profilen. Profilen görs anspråk på och verifieras av er med ert Google-konto.',
    kostnad: 'Profilen hanteras "at no charge" enligt Googles hjälpsida (läst 2026-09-28).',
    grans: 'Googles verifiering kan ta dagar till veckor; börja tidigt.',
  },
  {
    id: 'google_ads', grupp: 'Annonsering', namn: 'Google Ads',
    kort: 'Annonser i Googles sökresultat när någon söker efter det ni erbjuder.',
    digitala: 'Förbereder kampanjer i pausat läge utifrån era mål. Inget aktiveras och inga pengar spenderas utan ert uttryckliga beslut om budget och period.',
    kostnad: 'Annonskostnaden bestämmer ni; plattformens villkor och Digitalas arbete är ännu inte utredda för er.',
    grans: 'Ett önskemål här är inget tillstånd att starta eller betala annonser.',
  },
  {
    id: 'meta_ads', grupp: 'Annonsering', namn: 'Meta-annonser (Facebook och Instagram)',
    kort: 'Annonser i Facebook och Instagram till den målgrupp ni vill nå.',
    digitala: 'Förbereder kampanjer i pausat läge med er sida och rättigheter till bilderna. Inget aktiveras eller spenderas utan ert uttryckliga beslut.',
    kostnad: 'Annonskostnaden bestämmer ni; plattformens villkor och Digitalas arbete är ännu inte utredda för er.',
    grans: 'Ett önskemål här är inget tillstånd att starta eller betala annonser.',
  },
  {
    id: 'matning', grupp: 'Mätning', namn: 'Analys och mätning av förfrågningar',
    kort: 'Se vilka sidor och kanaler som leder till förfrågningar och bokningar, med besökarnas samtycke.',
    digitala: 'Tar fram en mätplan med samtycke och prövar att en händelse verkligen tas emot. Inget spårande innan samtycke där det krävs.',
    kostnad: 'Beror på valt verktyg; ännu inte utrett.',
    grans: 'Installerad kod är inte mätning förrän en händelse har observerats.',
  },
];

export const TILLVAL_IDS = new Set(TILLVAL.map((t) => t.id));

export const KUNDVAL_TEXT: Record<TillvalKundval, string> = {
  onskat: 'Ni vill ha detta',
  har_system: 'Ni har redan ett system',
  hjalp: 'Ni vill ha hjälp att välja',
  inte_nu: 'Inte nu',
};

export const DIGITALA_TEXT: Record<TillvalDigitala, string> = {
  inkluderat: 'Ingår i det accepterade uppdraget',
  vantar_atkomst: 'Väntar på åtkomst',
  anslutet_provat: 'Anslutet och prövat',
};

export function tillvalDef(id: string): TillvalDef | undefined {
  return TILLVAL.find((t) => t.id === id);
}

export function annatId(n: number): string {
  return 'annat_' + n;
}

export function arAnnat(id: string): boolean {
  return /^annat_\d{1,3}$/.test(id);
}

/** Aktuellt tillval för ett id (skapas inte här). */
export function hittaTillval(a: Arende, id: string): Tillval | undefined {
  return (a.tillval || []).find((t) => t.id === id);
}

/** Vilket namn kunden ser: katalogens namn eller kundens egen beskrivning av ett annat behov. */
export function tillvalNamn(t: Pick<Tillval, 'id' | 'beskrivning'>): string {
  return tillvalDef(t.id)?.namn || t.beskrivning || 'Annat behov';
}
