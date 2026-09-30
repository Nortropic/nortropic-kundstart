// B2/B3: endast låsfilens data, inga paket importeras eller körs.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const exakt = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const namn = plats => plats.split('node_modules/').at(-1);
export function kontrollera(lock, manifest) {
  if (lock?.lockfileVersion !== 3 || !lock.packages?.['']) throw Error('låsfil v3 krävs');
  for (const group of ['dependencies', 'devDependencies']) {
    const wanted = manifest[group] ?? {};
    if (JSON.stringify(lock.packages[''][group] ?? {}) !== JSON.stringify(wanted)) throw Error('manifest och låsfil skiljer sig');
    for (const [name, version] of Object.entries(wanted)) {
      if (!exakt.test(version) || lock.packages[`node_modules/${name}`]?.version !== version) throw Error(`direkt beroende ej exakt låst: ${name}`);
    }
  }
  for (const [plats, pkg] of Object.entries(lock.packages)) {
    if (!plats) continue;
    if (!/^(?:node_modules\/(?:@[\w.-]+\/)?[\w.-]+\/)*node_modules\/(?:@[\w.-]+\/)?[\w.-]+$/.test(plats) || pkg.link) throw Error('otillåten paketplats/länk');
    const u = new URL(pkg.resolved);
    if (u.protocol !== 'https:' || u.hostname !== 'registry.npmjs.org' || u.port || u.username || u.password || u.search || u.hash) throw Error(`otillåten källa: ${plats}`);
    const sri = /^(sha512|sha256)-([A-Za-z0-9+/]+={0,2})$/.exec(pkg.integrity ?? '');
    if (!sri || Buffer.from(sri[2], 'base64').length !== (sri[1] === 'sha512' ? 64 : 32)) throw Error(`integrity saknas/ogiltig: ${plats}`);
    if (pkg.hasInstallScript && namn(plats) !== 'unrs-resolver') throw Error(`nytt installationsskript: ${plats}`);
  }
}

export function andringar(bas, kandidat) {
  return Object.entries(kandidat.packages).filter(([p]) => p).sort(([a], [b]) => a.localeCompare(b)).flatMap(([plats, p]) => {
    const old = bas.packages?.[plats];
    if (old && JSON.stringify(old) === JSON.stringify(p)) return [];
    return [{ plats, namn: namn(plats), version: p.version, installationsskript: p.hasInstallScript === true,
      andring: old ? 'ändrat' : 'tillagt', tidigare_version: old?.version ?? null }];
  });
}

export function main(args = process.argv.slice(2)) {
  try {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    kontrollera(lock, JSON.parse(readFileSync('package.json', 'utf8')));
    let base;
    if (args.length) {
      if (args.length !== 2 || args[0] !== '--bas' || !/^[0-9a-f]{40}$/.test(args[1]) || /^0+$/.test(args[1])) throw Error('--bas kräver en befintlig commit');
      base = JSON.parse(execFileSync('git', ['show', `${args[1]}:package-lock.json`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    }
    console.log(JSON.stringify({ lasfil: 'godkänd', paketandringar: base ? andringar(base, lock) : null }, null, 2));
    return 0;
  } catch (error) { console.error(`Låsfil vägrad: ${error.message}`); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
