// L3: bara registrets data. Inga beroenden, inloggningar eller paketskript.
const dag = 24 * 60 * 60 * 1000;
const paketnamn = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const exakt = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function lasUndantag(value, nu = Date.now()) {
  if (value?.schema !== 1 || !Array.isArray(value.undantag)) throw Error('ogiltig undantagsfil');
  const result = new Map();
  for (const row of value.undantag) {
    if (!row || typeof row !== 'object' || !paketnamn.test(row.paket ?? '') || !exakt.test(row.version ?? '') ||
        typeof row.skal !== 'string' || !row.skal.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(row.datum ?? '') ||
        !Number.isFinite(Date.parse(row.datum)) || new Date(row.datum).toISOString().slice(0, 10) !== row.datum ||
        Date.parse(row.datum) > nu || result.has(`${row.paket}@${row.version}`)) throw Error('ogiltig eller upprepad undantagsrad');
    result.set(`${row.paket}@${row.version}`, row);
  }
  return result;
}

export async function registerTid(namn, version) {
  if (!paketnamn.test(namn) || !exakt.test(version)) throw Error('ogiltigt paket');
  // Full metadata includes per-version publication time; abbreviated install
  // metadata does not establish that date. No redirects or implicit auth.
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(namn)}`, {
    headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 200 || !response.body) throw Error('registeruppslag misslyckades');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024 * 1024) throw Error('registersvar för stort');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (data.name !== namn || !Object.hasOwn(data.time ?? {}, version)) throw Error('tidsuppgiften saknas eller gäller annat paket');
  return data.time[version];
}

export async function provaAlder(changes, undantag, { nu = Date.now(), lasTid = registerTid } = {}) {
  const exceptions = lasUndantag(undantag, nu), cache = new Map(), rows = [];
  for (const change of changes) {
    const key = `${change.namn}@${change.version}`;
    if (!cache.has(key)) {
      let result;
      try {
        const value = await lasTid(change.namn, change.version);
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) throw Error('ogiltig tid');
        const age = (nu - Date.parse(value)) / dag;
        const exception = exceptions.get(key);
        result = { publicerad: value, alder_dagar: Math.floor(age * 1000) / 1000,
          lage: age >= 7 || (age >= 0 && exception) ? 'godkänd' : 'för ny', undantag: exception ?? null };
      } catch { result = { publicerad: null, alder_dagar: null, lage: 'kunde inte kontrolleras', undantag: exceptions.get(key) ?? null }; }
      cache.set(key, result);
    }
    rows.push({ ...change, karenstid: cache.get(key) });
  }
  return { godkand: rows.every(row => row.karenstid.lage === 'godkänd'), paketandringar: rows };
}
