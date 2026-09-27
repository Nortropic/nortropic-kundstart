'use client';
// Klientens anrop: idempotensnyckel per handling, utkast i sessionStorage (försvinner när fliken stängs), tydliga fel.

export function nyNyckel(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function lasUtkast(nyckel: string): { text: string; idempotens: string } | null {
  try {
    const v = sessionStorage.getItem('kundstart:' + nyckel);
    return v ? (JSON.parse(v) as { text: string; idempotens: string }) : null;
  } catch {
    return null;
  }
}

export function sparaUtkast(nyckel: string, d: { text: string; idempotens: string } | null): void {
  try {
    if (d) sessionStorage.setItem('kundstart:' + nyckel, JSON.stringify(d));
    else sessionStorage.removeItem('kundstart:' + nyckel);
  } catch {
    /* utkast är en bekvämlighet */
  }
}

export class AnropsFel extends Error {
  status: number;
  fel?: string;
  constructor(msg: string, status: number, fel?: string) {
    super(msg);
    this.status = status;
    this.fel = fel;
  }
}

export async function anropa<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, credentials: 'same-origin', headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(init?.headers || {}) } });
  } catch {
    throw new AnropsFel('Ingen kontakt med servern. Det ni skrivit finns kvar här; försök igen om en stund.', 0);
  }
  const d = (await r.json().catch(() => ({}))) as { meddelande?: string; fel?: string } & T;
  if (!r.ok) throw new AnropsFel(d.meddelande || 'Något gick fel på servern.', r.status, d.fel);
  return d as T;
}

export function klockslag(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function storlek(b?: number): string {
  if (!b && b !== 0) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' kB';
  return (b / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
}

/** Förminskar en stor bild i webbläsaren så att den ryms i gränsen; andra filer lämnas orörda. */
export async function anpassaBild(fil: File, maxByte: number): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(fil.type) || fil.size <= maxByte) return fil;
  const bitmap = await createImageBitmap(fil).catch(() => null);
  if (!bitmap) return fil;
  const maxSida = 2200;
  const skala = Math.min(1, maxSida / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * skala);
  c.height = Math.round(bitmap.height * skala);
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  const blob: Blob | null = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
  if (!blob || blob.size > maxByte) return fil;
  const namn = fil.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], namn, { type: 'image/jpeg' });
}
