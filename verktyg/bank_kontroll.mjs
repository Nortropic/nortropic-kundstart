// Kontrollerar både arbetsfilen och revisionens verkliga byte. En matchande filhash
// ensam är inget bevis för det angivna Git-underlaget.
// node verktyg/bank_kontroll.mjs intervju.py [--repo /källrepo]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const bank = JSON.parse(readFileSync(new URL('../intervju-bank.json', import.meta.url), 'utf8'));
const fil = process.argv[2];
if (!fil) { console.error('ange sökvägen till intervju.py'); process.exit(2); }
const index = process.argv.indexOf('--repo');
const repo = index >= 0 ? process.argv[index + 1] : dirname(fil);
const sha = createHash('sha256').update(readFileSync(fil)).digest('hex');
const git = spawnSync('git', ['-C', repo, 'show', `${bank.kalla.git_rev}:${bank.kalla.fil}`]);
const revisionSha = git.status === 0 ? createHash('sha256').update(git.stdout).digest('hex') : null;
const lika = sha === bank.kalla.sha256;
const revisionVerifierad = revisionSha === bank.kalla.sha256;
console.log(JSON.stringify({ bank_sha256: bank.kalla.sha256, fil_sha256: sha, lika, git_rev: bank.kalla.git_rev, revision_sha256: revisionSha, revision_verifierad: revisionVerifierad }));
process.exit(lika && revisionVerifierad ? 0 : 1);
