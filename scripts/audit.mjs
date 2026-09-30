// B4: uppslagsfel är okänt, aldrig grönt. Npm:s JSON är data, inte instruktioner.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function bedom(resultat) {
  let d;
  try { d = JSON.parse(resultat.stdout); } catch { return { kod: 2, lage: 'kunde inte kontrolleras' }; }
  const unknown = { kod: 2, lage: 'kunde inte kontrolleras' };
  if (resultat.error || resultat.signal || ![0, 1].includes(resultat.status) || d.error || d.auditReportVersion !== 2 ||
      !d.vulnerabilities || Array.isArray(d.vulnerabilities) || !d.metadata?.vulnerabilities) return unknown;
  const counts = d.metadata.vulnerabilities;
  for (const level of ['info', 'low', 'moderate', 'high', 'critical', 'total']) {
    if (!Number.isInteger(counts[level]) || counts[level] < 0) return unknown;
  }
  const fynd = Object.entries(d.vulnerabilities);
  if (fynd.length !== counts.total || counts.total !== ['info', 'low', 'moderate', 'high', 'critical'].reduce((n, k) => n + counts[k], 0)) return unknown;
  for (const [, x] of fynd) {
    if (!['info', 'low', 'moderate', 'high', 'critical'].includes(x?.severity) || !Array.isArray(x.via)) return unknown;
  }
  const malware = /malware|malicious|skadlig kod|CWE-506/i.test(JSON.stringify(d.vulnerabilities));
  const blocked = malware || counts.high > 0 || counts.critical > 0 || fynd.some(([, x]) => ['high', 'critical'].includes(x.severity));
  if (blocked) return { kod: 1, lage: malware ? 'stopp: meddelande om skadlig kod' : 'stopp: hög eller kritisk sårbarhet', antal: counts };
  if (resultat.status !== 0) return unknown;
  return { kod: 0, lage: 'inga höga/kritiska eller rapporterade skadliga beroenden', antal: counts };
}

export function main() {
  const raw = spawnSync('npm', ['audit', '--json', '--audit-level=high', '--ignore-scripts'],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const result = bedom(raw);
  console.log(JSON.stringify(result, null, 2));
  // Rårapporten innehåller paket/rådgivningar, inga credentials; bevara den i CI-loggen.
  if (result.kod !== 2) console.log(JSON.stringify({ vulnerabilities: JSON.parse(raw.stdout).vulnerabilities }, null, 2));
  return result.kod;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
