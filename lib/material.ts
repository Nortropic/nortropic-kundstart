// Material: tillåtna filtyper kontrolleras på servern med magiska byte, inte bara filändelse eller uppgiven typ.
// Gränser: 4 MB per fil (Vercel-funktionens kroppsgräns är 4,5 MB), 25 filer och 40 MB per ärende.
export const MAX_FIL = 4_000_000;
export const MAX_ANTAL = 25;
export const MAX_TOTAL = 40_000_000;

export interface Filtyp { mime: string; andelser: string[]; namn: string }

export const TILLATNA: Filtyp[] = [
  { mime: 'image/jpeg', andelser: ['jpg', 'jpeg'], namn: 'JPEG-bild' },
  { mime: 'image/png', andelser: ['png'], namn: 'PNG-bild' },
  { mime: 'image/webp', andelser: ['webp'], namn: 'WebP-bild' },
  { mime: 'image/svg+xml', andelser: ['svg'], namn: 'SVG-bild' },
  { mime: 'application/pdf', andelser: ['pdf'], namn: 'PDF' },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', andelser: ['docx'], namn: 'Word-dokument' },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', andelser: ['xlsx'], namn: 'Excel-dokument' },
  { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', andelser: ['pptx'], namn: 'PowerPoint' },
  { mime: 'text/plain', andelser: ['txt', 'md'], namn: 'Textfil' },
  { mime: 'text/csv', andelser: ['csv'], namn: 'CSV' },
];

export const TILLATNA_ANDELSER = TILLATNA.flatMap((t) => t.andelser);

function borjarMed(b: Uint8Array, ...bytes: number[]): boolean {
  return bytes.every((x, i) => b[i] === x);
}

function arText(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, 65536));
    return true;
  } catch {
    return false;
  }
}

/** Avgör typ ur innehållet; returnerar null när innehållet inte motsvarar en tillåten typ. */
export function identifiera(filnamn: string, b: Uint8Array): Filtyp | null {
  const andelse = (filnamn.split('.').pop() || '').toLowerCase();
  const typ = TILLATNA.find((t) => t.andelser.includes(andelse));
  if (!typ) return null;
  switch (typ.mime) {
    case 'image/jpeg':
      return borjarMed(b, 0xff, 0xd8, 0xff) ? typ : null;
    case 'image/png':
      return borjarMed(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ? typ : null;
    case 'image/webp':
      return borjarMed(b, 0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 ? typ : null;
    case 'image/svg+xml': {
      if (!arText(b)) return null;
      const huvud = new TextDecoder().decode(b.subarray(0, 2048)).toLowerCase();
      if (!huvud.includes('<svg')) return null;
      if (/<script|on[a-z]+\s*=|javascript:|<foreignobject/i.test(new TextDecoder().decode(b))) return null;
      return typ;
    }
    case 'application/pdf':
      return borjarMed(b, 0x25, 0x50, 0x44, 0x46) ? typ : null;
    case 'text/plain':
    case 'text/csv':
      return arText(b) ? typ : null;
    default:
      // docx/xlsx/pptx: zip-behållare
      return borjarMed(b, 0x50, 0x4b, 0x03, 0x04) ? typ : null;
  }
}

export function sakertFilnamn(namn: string): string {
  const rent = namn.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120);
  return rent || 'fil';
}

export function rimligLank(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.includes('.') && url.length <= 500;
  } catch {
    return false;
  }
}
