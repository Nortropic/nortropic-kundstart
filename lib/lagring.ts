// Lagring: privata JSON-dokument och filer i Vercel Blob. Uppdateringar sker med villkorad skrivning (ifMatch/ETag)
// och omförsök, så att två flikar eller ett dubbelklick aldrig skriver över varandra tyst. Läsningar går förbi cachen.
import { BlobPreconditionFailedError, del, get, put } from '@vercel/blob';

export class KonfliktEfterOmforsok extends Error {}

/** Lagret ger en svag ETag (W/"…") för komprimerade svar; den villkorade skrivningen jämför den starka formen. */
export function starkEtag(etag: string): string {
  return etag.replace(/^W\//, '');
}

export async function lasDok<T>(pathname: string): Promise<{ data: T; etag: string } | null> {
  const r = await get(pathname, { access: 'private', useCache: false });
  if (!r || !r.stream) return null;
  const text = await new Response(r.stream).text();
  return { data: JSON.parse(text) as T, etag: starkEtag(r.blob.etag) };
}

export async function skapaDok<T>(pathname: string, data: T): Promise<void> {
  await put(pathname, JSON.stringify(data), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: false,
    cacheControlMaxAge: 60,
  });
}

export async function skrivDok<T>(pathname: string, data: T, etag: string): Promise<string> {
  const r = await put(pathname, JSON.stringify(data), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    ifMatch: etag,
    cacheControlMaxAge: 60,
  });
  return r.etag;
}

/** Läs–ändra–skriv med ETag. `andra` returnerar det nya dokumentet eller null för "ingen ändring". */
export async function uppdateraDok<T>(
  pathname: string,
  andra: (aktuell: T) => T | null,
  forsok = 6,
): Promise<{ data: T; skrev: boolean }> {
  for (let i = 0; i < forsok; i++) {
    const lasning = await lasDok<T>(pathname);
    if (!lasning) throw new Error('dokumentet finns inte: ' + pathname);
    const nytt = andra(lasning.data);
    if (nytt === null) return { data: lasning.data, skrev: false };
    try {
      await skrivDok(pathname, nytt, lasning.etag);
      return { data: nytt, skrev: true };
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) {
        console.warn('lagring: villkorad skrivning avvisad, försök %d av %d (%s)', i + 1, forsok, pathname.split('/')[0]);
        await new Promise((r) => setTimeout(r, 60 * (i + 1) + Math.random() * 80));
        continue;
      }
      console.error('lagring: skrivning misslyckades (%s): %s', pathname.split('/')[0], (e as Error).message);
      throw e;
    }
  }
  throw new KonfliktEfterOmforsok('samtidiga ändringar; försök igen');
}

export async function laggFil(pathname: string, body: ArrayBuffer, contentType: string): Promise<string> {
  const r = await put(pathname, body, { access: 'private', contentType, allowOverwrite: false, addRandomSuffix: true, cacheControlMaxAge: 60 });
  return r.pathname;
}

export async function hamtaFil(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string | null; size: number | null } | null> {
  const r = await get(pathname, { access: 'private', useCache: true });
  if (!r || !r.stream) return null;
  return { stream: r.stream, contentType: r.blob.contentType, size: r.blob.size };
}

export async function taBortFil(pathname: string): Promise<void> {
  await del(pathname);
}
