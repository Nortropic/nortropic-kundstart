// Kontroll: intervju-bank.json:s sha256 mot en given intervju.py (drift mellan Kundstart och Digitalas frågebank).
//   node verktyg/bank_kontroll.mjs /sökväg/nortropic-digitala/verktyg/intervju.py
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const bank = JSON.parse(readFileSync(new URL('../intervju-bank.json', import.meta.url), 'utf8'));
const fil = process.argv[2];
if (!fil) { console.error('ange sökvägen till intervju.py'); process.exit(2); }
const sha = createHash('sha256').update(readFileSync(fil)).digest('hex');
const lika = sha === bank.kalla.sha256;
console.log(JSON.stringify({ bank_sha256: bank.kalla.sha256, fil_sha256: sha, lika, git_rev: bank.kalla.git_rev }));
process.exit(lika ? 0 : 1);
