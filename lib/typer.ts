// Ärendets datamodell. Ett ärende är ett JSON-dokument i det privata Blob-lagret (arenden/<id>.json) som bara ändras
// genom villkorad skrivning (ETag). Kundens svar återges alltid ordagrant; AI:ns tolkningar är egna rader med status.

export type FaktaStatus = 'kunden uppger' | 'observerat' | 'externt belagt' | 'tolkning' | 'hypotes' | 'preferens' | 'okänt';

export interface Fakta {
  nyckel: string;
  varde: string;
  status: FaktaStatus;
  kalla: string;
  omrade: string;
  datum: string;
}

export interface FaktaAi extends Fakta {
  bas_revision: number;
  giltig: boolean;
  forkastad_skal?: string;
  modell?: string;
}

export type FragaStatus = 'stalld' | 'besvarad' | 'tackt' | 'senare';

export interface Fraga {
  id: string;
  omrade: string;
  nyckel: string;
  text: string;
  paverkar: string;
  utlost_av?: string | null;
  kalla: 'bank' | 'ai-omformulering' | 'returfraga' | 'behov' | 'agent';
  banktext?: string;
  typ: 'oppen' | 'val' | 'tillval';
  alternativ?: string[];
  /** Agentens kundvända återkoppling före frågan (det den förstått), sparad så att samtalet kan visas igen. */
  inledning?: string;
  /** Öppningsfrågan och avslutsfrågan (sista tankar) är samtalets ramar, inte bankämnen. */
  roll?: 'oppning' | 'avslut';
  /** Tillval som visas som kontroller i frågan (typ 'tillval'). */
  tillval?: string[];
  omgang: number;
  stalld: string;
  oppnad_revision?: number;
  status: FragaStatus;
  valjare: 'regelstyrd' | 'ai';
}

export interface Svar {
  fraga_id: string;
  nyckel: string;
  omrade: string;
  text: string;
  typ: 'text' | 'vet_inte' | 'val' | 'ej_tillampligt' | 'atkomst_saknas';
  mottaget: string;
  revision: number;
  idempotens: string;
  ersatter?: number;
}

export interface Rattelse {
  nyckel: string;
  varde: string;
  mottaget: string;
  revision: number;
  idempotens: string;
  tidigare: { varde: string; kalla: string; typ: 'forifylld' | 'ai' | 'svar' | 'ingen' };
}

export interface Material {
  id: string;
  typ: 'fil' | 'lank';
  filnamn?: string;
  mime?: string;
  storlek?: number;
  sha256?: string;
  blob?: string;
  url?: string;
  beskrivning?: string;
  status: 'mottagen' | 'borttagen';
  mottaget: string;
  revision: number;
  idempotens: string;
  extraktion?: { text: string; format: string; kalla_sha256: string; varning: string };
  lasning?: { tid: string; utforare: string; resultat: string; sha256: string };
}

export interface Handelse {
  tid: string;
  typ: string;
  revision: number;
  detaljer?: Record<string, unknown>;
}

export type AiLage = 'gateway' | 'claude-cli' | 'regelstyrd';

export interface AiTillstand {
  lage: AiLage;
  modell?: string;
  anrop: number;
  tokens_in: number;
  tokens_out: number;
  /** Faktisk kostnad enligt gatewayens usage.cost (USD), summerad per ärende; okänd förbrukning redovisas separat. */
  kostnad_usd?: number;
  okand_kostnad_usd?: number;
  /** Pågående modellanrop för ärendet: hindrar två samtidiga anrop (två flikar, dubbelklick). */
  pagaende?: { id: string; till: string } | null;
  senaste_ms?: number;
  budget_skal?: string;
  fel: number;
  fel_i_rad?: number;
  senaste_fel?: string;
  senaste_fel_tid?: string;
  senaste_lyckade?: string;
  paus_till?: string;
  aktuell?: 'aktiv' | 'reserv' | 'pausad' | 'av';
  felklass?: string;
  diagnostik?: Record<string, unknown>[];
  /** Modellens kvot är slut (claude-cli, per modell): botemedlet är att byta modell, inte att vänta ut en paus. */
  kvot?: { modell: string; aterstalls?: string; besked: string; tid: string } | null;
}

/** Intervjuns faser: startskärm, samtalet, avrundning, genomläsning med sammanfattning, inlämnat. */
export type Fas = 'intro' | 'intervju' | 'avslut' | 'granskning' | 'inlamnat';
export interface FasByte { fran: Fas | null; till: Fas; tid: string; revision: number; av: 'kund' | 'ai' | 'regelstyrd' | 'digitala' }

/** Guidens nyckel som en tur berört (nämnd, mer behövs) eller täckt (räcker för nästa arbetssteg). */
export interface Berord { nyckel: string; lage: 'berord' | 'tackt'; fraga_id: string; revision: number }

/** Sammanfattningen efter avslutad intervju: intervjuarens (ai) eller en deterministisk sammanställning (regelstyrd). */
export interface Syntes {
  id: string;
  status: 'klar' | 'misslyckad' | 'inaktuell';
  bas_revision: number;
  revision: number;
  tid: string;
  valjare: 'ai' | 'regelstyrd';
  modell?: string;
  anstrangning?: string;
  ms?: number;
  forsok: number;
  fel?: string;
  sammanfattning: string;
  nyckelinsikt: string;
  oppet: { nyckel: string; varfor: string }[];
  avvisade?: number;
}

/** Kundens bekräftelse vid inlämning: exakt den text som visades, versionerad. transkript_last är klientens uppgift. */
export interface Samtycke { version: 'samtycke/1'; text: string; tid: string; revision: number; syntes_id: string | null; transkript_last: true; idempotens: string }

export interface Inlamning {
  tid: string;
  revision: number;
  svar: number;
  material: number;
  samtycke?: Samtycke;
}

export interface Arende {
  schema: 'kundstart-arende/1';
  id: string;
  kund: { slug: string; namn: string };
  kontakt?: string;
  kanal: string;
  testdialog: boolean;
  skapad: string;
  uppdaterad: string;
  revision: number;
  fakta_forifyllda: Fakta[];
  fragor: Fraga[];
  svar: Svar[];
  rattelser: Rattelse[];
  fakta_ai: FaktaAi[];
  material: Material[];
  foljdregler_utlosta: { regel: string; fraga_id: string; traff: string; tid: string }[];
  foljdregler_negerade?: { regel: string; fraga_id: string; traff: string; sats: string; tid: string }[];
  ai: AiTillstand;
  omgang: number;
  inlamningar: Inlamning[];
  handelser: Handelse[];
  signal?: Signal;
  kvittenser?: { signal_id: string; revision: number; utforare: string; import_sha256: string; tid: string }[];
  returfragor?: { idempotens: string; bas_revision: number; utforare: string; fragor: string[]; tid: string }[];
  behov?: Behov[];
  /** Kunduppgifter och tolkningar som agenten noterat med ordagrant källcitat (servern verifierar citatet). */
  uppgifter?: Uppgift[];
  /** Integrationstillval: kundens val, agentens rekommendation och Digitalas status hålls isär. */
  tillval?: Tillval[];
  /** Avgränsad research som agenten beställt av Digitala; status 'bestalld' betyder att arbetet inte har börjat. */
  research?: ResearchBestallning[];
  /** Agentens täckningsmarkeringar för bankens områden: vet inte, inte tillämpligt, avstår. */
  tackning_agent?: TackningMarkering[];
  /** Samtalet avslutat av agenten (eller standardlistan) vid en viss revision; ny kundhandling kan öppna det igen. */
  samtal_klar?: { revision: number; tid: string; meddelande: string; valjare: 'ai' | 'regelstyrd' | 'kund' } | null;
  /** Intervjuns fas (intro → intervju → avslut → granskning → inlamnat). Äldre dokument saknar fältet och härleds (fasAv). */
  fas?: Fas;
  fas_historik?: FasByte[];
  /** Guidens nycklar som turerna berört eller täckt enligt intervjuaren; styr avrundningen, inte exportens täckning. */
  berorda?: Berord[];
  /** Sammanfattningen efter avslutad intervju. */
  syntes?: Syntes | null;
}

export interface Uppgift {
  id: string;
  nyckel: string;
  rubrik: string;
  avsnitt: 'mal' | 'verksamhet';
  /** 'kunden uppger' när värdet är kundens egna ord (ordagrant citat); 'tolkning' när agenten sammanfattat. */
  status: 'kunden uppger' | 'tolkning';
  varde: string;
  citat: string;
  kalla_typ: 'svar' | 'material';
  kalla_id: string; // fråge-id eller material-id
  kalla_revision: number;
  bas_revision: number;
  revision: number;
  tid: string;
  giltig: boolean;
  forkastad_skal?: string;
  modell?: string;
  /** Täckningsstödets nyckel som uppgiften helt eller delvis besvarar (styr täckning och område i översikten). */
  tacker?: string;
}

export type TillvalKundval = 'onskat' | 'har_system' | 'hjalp' | 'inte_nu';
export type TillvalDigitala = 'inkluderat' | 'vantar_atkomst' | 'anslutet_provat';

export interface TillvalHandelse {
  tid: string;
  revision: number;
  kundval: TillvalKundval | null;
  system?: string;
  not?: string;
  kalla: 'kontroll' | 'samtal';
  fraga_id?: string;
  citat?: string;
  idempotens?: string;
}

export interface Tillval {
  id: string; // katalog-id eller annat_N
  beskrivning?: string; // kundens beskrivning av ett annat behov
  kundval: TillvalKundval | null;
  system?: string;
  not?: string;
  kalla?: 'kontroll' | 'samtal';
  citat?: string;
  fraga_id?: string;
  revision: number; // revision där kundens val senast ändrades
  rekommendation?: { text: string; bas_revision: number; revision: number; tid: string; modell?: string; giltig: boolean };
  digitala?: { status: TillvalDigitala; not: string; kalla: string; utforare: string; tid: string; idempotens: string } | null;
  /** Senaste domänkontroll (tillvalet doman): öppna DNS/RDAP-uppgifter, en daterad observation. */
  kontroll?: import('./doman').DomanKontroll | null;
  historik: TillvalHandelse[];
}

export interface ResearchBestallning {
  id: string;
  fraga: string;
  varfor: string;
  /** Täckningsnyckel som researchen besvarar, om någon (då frågas kunden inte om den). */
  nyckel?: string;
  kalla_typ: 'svar' | 'material' | 'kand';
  kalla_id: string;
  citat: string;
  status: 'bestalld';
  revision: number;
  tid: string;
  modell?: string;
}

export interface TackningMarkering {
  nyckel: string;
  lage: 'kunden_vet_inte' | 'inte_tillampligt' | 'kunden_avstar';
  citat: string;
  fraga_id: string;
  revision: number;
  tid: string;
  giltig: boolean;
}

export interface Lank {
  arende_id: string;
  skapad: string;
  utgar: string;
  aterkallad?: string | null;
  anvand_senast?: string;
  anvandningar: number;
}

export interface SessionsData {
  a: string; // arende_id
  l: string; // länkens hash (sha256 hex)
  exp: number; // unix-sekunder
}

export interface Signal { id: string; arende_id: string; kund: { slug: string; namn: string }; revision: number; typ: 'inlamning' | 'komplettering'; skapad: string }
export interface Behov { id: string; nyckel: string; citat: string; fraga: string; kalla_fraga: string; revision: number; status: 'oppen' | 'besvarad' | 'tackt'; metod: 'regel' | 'ai'; }
