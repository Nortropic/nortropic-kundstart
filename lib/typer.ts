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
  kalla: 'bank' | 'ai-omformulering';
  banktext?: string;
  typ: 'oppen' | 'val';
  alternativ?: string[];
  omgang: number;
  stalld: string;
  status: FragaStatus;
  valjare: 'regelstyrd' | 'ai';
}

export interface Svar {
  fraga_id: string;
  nyckel: string;
  omrade: string;
  text: string;
  typ: 'text' | 'vet_inte' | 'val';
  mottaget: string;
  revision: number;
  idempotens: string;
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
  fel: number;
  senaste_fel?: string;
  senaste_fel_tid?: string;
  paus_till?: string;
}

export interface Inlamning {
  tid: string;
  revision: number;
  svar: number;
  material: number;
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
