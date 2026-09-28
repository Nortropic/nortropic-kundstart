// Domänkontroll för tillvalet "Egen domän": en avgränsad läsning av öppna uppgifter, aldrig en ändring.
//
// Läser DNS genom DNS över HTTPS hos en fast resolver (cloudflare-dns.com) och, där registret erbjuder det, registrets
// RDAP-svar genom IANA:s bootstrapfil (data.iana.org). Inga andra värdar anropas och inga omdirigeringar följs, så
// kundens inmatning kan inte styra servern mot interna adresser. .se och .nu saknas i IANA:s RDAP-bootstrap; där bygger
// beskedet enbart på DNS och sägs vara en ögonblicksbild, inte ett registerbesked. Ingen domän köps och ingenting
// ändras hos kundens domän- eller e-postleverantör.
import { domainToASCII } from 'node:url';

export interface DomanKontroll {
  doman: string;
  tid: string;
  registrerad: boolean | null; // null = kunde inte avgöras
  kalla_registrering: 'rdap' | 'dns' | 'okand';
  namnservrar: string[];
  dns_leverantor: string | null;
  epost: { finns: boolean; leverantor: string | null };
  webb: { finns: boolean; varden: string | null };
  registrar: string | null;
  ettklick: boolean; // DNS hos en leverantör där Vercels Domain Connect-flöde finns (Cloudflare, februari 2025)
  anmarkningar: string[];
  fel?: string;
}

const DOH = 'https://cloudflare-dns.com/dns-query';
const IANA = 'https://data.iana.org/rdap/dns.json';

/** Normaliserar kundens inmatning till ett domännamn: utan protokoll, sökväg och www., gemener, IDN som punycode. */
export function normaliseraDoman(indata: string): string | null {
  let s = String(indata || '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (s.startsWith('www.')) s = s.slice(4);
  if (!s || s.length > 253 || /\s/.test(s)) return null;
  const ascii = domainToASCII(s);
  if (!ascii) return null;
  const delar = ascii.split('.');
  if (delar.length < 2 || delar.length > 4) return null;
  if (!delar.every((d) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(d))) return null;
  if (!/^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/.test(delar[delar.length - 1])) return null;
  if (['localhost', 'local', 'internal', 'test', 'example', 'invalid', 'arpa'].includes(delar[delar.length - 1])) return null;
  return ascii;
}

const LEVERANTORER: [RegExp, string][] = [
  [/vercel-dns\.com$/, 'Vercel'], [/cloudflare\.com$/, 'Cloudflare'], [/loopia\.(se|com)$/, 'Loopia'], [/one\.com$/, 'One.com'],
  [/binero\.(se|net)$/, 'Binero'], [/domainnameshop\.com$|domeneshop\.no$/, 'Domeneshop'], [/awsdns/, 'Amazon Route 53'],
  [/googledomains\.com$|google\.com$/, 'Google'], [/domaincontrol\.com$/, 'GoDaddy'], [/registrar-servers\.com$/, 'Namecheap'],
  [/wixdns\.net$/, 'Wix'], [/squarespacedns\.com$/, 'Squarespace'], [/hostinger\.com$|dns-parking\.com$/, 'Hostinger'],
  [/inleed\.(se|net)$/, 'Inleed'], [/websupport\.se$/, 'Websupport'], [/simply\.com$|unoeuro\.com$/, 'Simply.com'],
  [/glesys\.(se|com)$/, 'GleSYS'], [/ns\.(ovh|ovh\.net)$|ovh\.net$/, 'OVH'], [/gandi\.net$/, 'Gandi'], [/misshosting\.(se|com)$/, 'Miss Hosting'],
  [/netim\.net$/, 'Netim'], [/ionos|ui-dns/, 'IONOS'], [/azure-dns/, 'Microsoft Azure'], [/nsone\.net$/, 'NS1'],
];

const EPOST: [RegExp, string][] = [
  [/google\.com$|googlemail\.com$/, 'Google Workspace'], [/outlook\.com$/, 'Microsoft 365'], [/one\.com$/, 'One.com'],
  [/loopia\.se$/, 'Loopia'], [/zoho\.(com|eu)$/, 'Zoho'], [/messagingengine\.com$/, 'Fastmail'], [/binero\.se$/, 'Binero'],
  [/icloud\.com$/, 'iCloud'], [/protonmail\.ch$/, 'Proton'], [/mailgun\.org$/, 'Mailgun'], [/improvmx\.com$/, 'ImprovMX'],
  [/simply\.com$/, 'Simply.com'], [/misshosting\.(se|com)$/, 'Miss Hosting'], [/websupport\.se$/, 'Websupport'],
];

function vem(host: string, tabell: [RegExp, string][]): string {
  const h = host.replace(/\.$/, '').toLowerCase();
  for (const [rx, namn] of tabell) if (rx.test(h)) return namn;
  return h.split('.').slice(-2).join('.');
}

interface DohSvar { Status: number; Answer?: { name: string; type: number; data: string }[] }

async function hamtaJson<T>(url: string, accept: string, ms: number): Promise<{ status: number; data: T | null }> {
  const styr = new AbortController();
  const t = setTimeout(() => styr.abort(), ms);
  try {
    const r = await fetch(url, { headers: { accept }, redirect: 'manual', signal: styr.signal, cache: 'no-store' });
    if (r.status >= 300 && r.status < 400) return { status: r.status, data: null };
    const text = await r.text();
    if (text.length > 200_000) return { status: r.status, data: null };
    try { return { status: r.status, data: JSON.parse(text) as T }; } catch { return { status: r.status, data: null }; }
  } finally {
    clearTimeout(t);
  }
}

async function dns(namn: string, typ: 'NS' | 'A' | 'AAAA' | 'CNAME' | 'MX'): Promise<DohSvar | null> {
  const r = await hamtaJson<DohSvar>(`${DOH}?name=${encodeURIComponent(namn)}&type=${typ}`, 'application/dns-json', 4000).catch(() => null);
  return r?.status === 200 && r.data && typeof r.data.Status === 'number' ? r.data : null;
}

let bootstrap: { tid: number; karta: Map<string, string> } | null = null;

async function rdapBas(tld: string): Promise<string | null> {
  if (!bootstrap || Date.now() - bootstrap.tid > 24 * 3600_000) {
    const r = await hamtaJson<{ services: [string[], string[]][] }>(IANA, 'application/json', 5000).catch(() => null);
    if (r?.status === 200 && r.data?.services) {
      const karta = new Map<string, string>();
      for (const [tlds, urls] of r.data.services) {
        const https = urls.find((u) => u.startsWith('https://'));
        if (https) for (const t of tlds) karta.set(t.toLowerCase(), https.endsWith('/') ? https : https + '/');
      }
      bootstrap = { tid: Date.now(), karta };
    }
  }
  return bootstrap?.karta.get(tld) || null;
}

type RdapEntitet = { roles?: string[]; vcardArray?: [string, [string, unknown, string, unknown][]] };

async function rdap(doman: string): Promise<{ registrerad: boolean | null; registrar: string | null }> {
  const bas = await rdapBas(doman.split('.').pop()!);
  if (!bas) return { registrerad: null, registrar: null };
  const r = await hamtaJson<{ entities?: RdapEntitet[] }>(bas + 'domain/' + encodeURIComponent(doman), 'application/rdap+json', 5000).catch(() => null);
  if (!r) return { registrerad: null, registrar: null };
  if (r.status === 404) return { registrerad: false, registrar: null };
  if (r.status !== 200 || !r.data) return { registrerad: null, registrar: null };
  const ent = (r.data.entities || []).find((e) => e.roles?.includes('registrar'));
  const fn = ent?.vcardArray?.[1]?.find((f) => f[0] === 'fn')?.[3];
  return { registrerad: true, registrar: typeof fn === 'string' ? fn.slice(0, 120) : null };
}

/** Läser öppna uppgifter om domänen. Kastar aldrig; ett tekniskt fel blir ett ärligt "kunde inte kontrolleras". */
export async function kontrolleraDoman(doman: string): Promise<DomanKontroll> {
  const k: DomanKontroll = { doman, tid: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), registrerad: null, kalla_registrering: 'okand', namnservrar: [], dns_leverantor: null, epost: { finns: false, leverantor: null }, webb: { finns: false, varden: null }, registrar: null, ettklick: false, anmarkningar: [] };
  try {
    const [ns, a, www, mx, reg] = await Promise.all([dns(doman, 'NS'), dns(doman, 'A'), dns('www.' + doman, 'CNAME'), dns(doman, 'MX'), rdap(doman)]);
    if (!ns) {
      k.fel = 'DNS kunde inte läsas just nu';
      return k;
    }
    k.namnservrar = (ns.Answer || []).filter((x) => x.type === 2).map((x) => x.data.replace(/\.$/, '').toLowerCase()).slice(0, 8);
    if (reg.registrerad !== null) {
      k.registrerad = reg.registrerad;
      k.kalla_registrering = 'rdap';
      k.registrar = reg.registrar;
    } else if (ns.Status === 3) {
      k.registrerad = false;
      k.kalla_registrering = 'dns';
    } else if (k.namnservrar.length) {
      k.registrerad = true;
      k.kalla_registrering = 'dns';
    }
    if (k.namnservrar.length) {
      k.dns_leverantor = vem(k.namnservrar[0], LEVERANTORER);
      k.ettklick = k.namnservrar.every((n) => /cloudflare\.com$/.test(n));
    }
    const mxVarden = (mx?.Answer || []).filter((x) => x.type === 15).map((x) => x.data.split(' ').pop()!.replace(/\.$/, '').toLowerCase()).filter((x) => x && x !== '.');
    if (mxVarden.length) k.epost = { finns: true, leverantor: vem(mxVarden[0], EPOST) };
    const aVarden = (a?.Answer || []).filter((x) => x.type === 1).map((x) => x.data);
    const wwwVarden = (www?.Answer || []).filter((x) => x.type === 5).map((x) => x.data.replace(/\.$/, '').toLowerCase());
    if (aVarden.length || wwwVarden.length) k.webb = { finns: true, varden: wwwVarden.length ? vem(wwwVarden[0], LEVERANTORER) : null };
    if (k.registrerad === false) k.anmarkningar.push(k.kalla_registrering === 'rdap' ? 'Registret har ingen registrering av namnet just nu.' : 'Namnet finns inte i DNS just nu. Det tyder på att domänen är ledig, men det bekräftas först vid registrering.');
    if (k.epost.finns) k.anmarkningar.push('Det finns e-post på domänen. Den ska fortsätta fungera: vid publiceringen ändras bara webbadressens poster.');
    if (k.webb.finns) k.anmarkningar.push('Det finns en webbplats på adressen i dag. Gamla länkar behöver leda rätt när den nya webbplatsen kopplas.');
    if (k.ettklick) k.anmarkningar.push('Er DNS hanteras av Cloudflare, där domänen kan kopplas med ett godkännande i stället för att föra över värden för hand.');
  } catch {
    k.fel = 'uppgifterna kunde inte läsas just nu';
  }
  return k;
}

/** Kort kundvänd sammanfattning av en kontroll. */
export function kontrollText(k: DomanKontroll): string {
  if (k.fel) return `Vi kunde inte kontrollera ${k.doman} just nu (${k.fel}). Er uppgift är ändå sparad.`;
  const delar: string[] = [];
  if (k.registrerad === true) delar.push(`${k.doman} är registrerad${k.registrar ? ` via ${k.registrar}` : ''}${k.dns_leverantor ? `; DNS hanteras av ${k.dns_leverantor}` : ''}.`);
  else if (k.registrerad === false) delar.push(`${k.doman} verkar ledig.`);
  else delar.push(`Vi kunde inte avgöra om ${k.doman} är registrerad.`);
  if (k.epost.finns) delar.push(`E-post finns på domänen${k.epost.leverantor ? ` (${k.epost.leverantor})` : ''}.`);
  if (k.webb.finns) delar.push('Det finns en webbplats på adressen i dag.');
  return delar.join(' ');
}
