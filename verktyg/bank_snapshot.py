#!/usr/bin/env python3
"""Snapshot av Digitalas frågebank ur verktyg/intervju.py (huvudspårets fil, ägs av nortropic-digitala) till
intervju-bank.json. Kundstart har inga egna intervjufrågor: id, texter, områden, prioriteter och följdregler kommer
härifrån och inget annat. Kvittot bär filens sha256 och git-revision så att avvikelse syns (verktyg/bank_kontroll.mjs).

    python3 -B verktyg/bank_snapshot.py --intervju /sökväg/nortropic-digitala/verktyg/intervju.py --ut intervju-bank.json
"""
import argparse, hashlib, importlib.util, json, re, subprocess, tempfile
from pathlib import Path


def git(dir_, *args):
    try:
        return subprocess.run(['git', '-C', str(dir_), *args], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--intervju', required=True)
    p.add_argument('--ut', required=True)
    p.add_argument('--rev', help='git-revision att ange när filen hämtats ur en annan revision än arbetsträdet (t.ex. origin/main via git show)')
    p.add_argument('--gren', help='grennamn att ange tillsammans med --rev')
    p.add_argument('--repo', help='Git-repo för verifiering när källfilen är exporterad till en annan katalog')
    a = p.parse_args()
    src = Path(a.intervju).resolve()
    data = src.read_bytes()
    repo = Path(a.repo).resolve() if a.repo else src.parent
    rot = git(repo, 'rev-parse', '--show-toplevel')
    rev = git(repo, 'rev-parse', '--verify', (a.rev or 'HEAD') + '^{commit}')
    if not rot or not rev:
        p.error('källrevisionen måste kunna verifieras i ett Git-repo')
    committed = subprocess.run(['git', '-C', rot, 'show', rev + ':verktyg/intervju.py'], capture_output=True, check=True).stdout
    matchar_revision = data == committed
    if a.rev and not matchar_revision:
        p.error('källfilens byte motsvarar inte den angivna revisionens verktyg/intervju.py')
    gren = a.gren or git(repo, 'branch', '--show-current')
    if a.gren:
        exists = git(repo, 'rev-parse', '--verify', a.gren + '^{commit}')
        ancestor = subprocess.run(['git', '-C', rot, 'merge-base', '--is-ancestor', rev, a.gren], capture_output=True)
        if not exists or ancestor.returncode:
            p.error('revisionen är inte verifierad i den angivna grenens historik')
    tracked_source = Path(rot) / 'verktyg/intervju.py'
    # Arbetsfilens renhet och identitet mot revisionen är två olika mätningar.
    smuts = git(Path(rot), 'status', '--porcelain', '--', 'verktyg/intervju.py') if src == tracked_source else None
    ren = (smuts == '') if smuts is not None else None
    # Importera exakt de byte som just verifierades, inte en fil som kan ändras
    # mellan hash/git-kontroll och modulladdning.
    with tempfile.TemporaryDirectory(prefix='kundstart-bank-') as temp:
        frozen = Path(temp) / 'intervju.py'
        frozen.write_bytes(data)
        spec = importlib.util.spec_from_file_location('intervju', frozen)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
    ut = {
        'schema': 'kundstart-bank/1',
        'kalla': {'fil': 'verktyg/intervju.py', 'repo': 'Nortropic/nortropic-digitala', 'sha256': hashlib.sha256(data).hexdigest(),
                  'git_rev': rev, 'gren': gren, 'ren': ren, 'ren_omfattning': 'källfilen i arbetsträdet' if ren is not None else 'ej mätbar: exporterad fil utanför källans plats', 'revision_verifierad': matchar_revision},
        'per_omgang': m.PER_OMGANG,
        'statusar': list(m.STATUSAR),
        'omraden': m.OMRADEN,
        'grund': [{'id': g[0], 'omrade': g[1], 'nyckel': g[2], 'text': g[3], 'paverkar': g[4], 'prio': g[5]} for g in m.GRUND],
        'foljdregler': [{'namn': n, 'monster': rx.pattern, 'flaggor': ('i' if rx.flags & re.I else ''),
                         'fragor': [{'id': f[0], 'omrade': f[1], 'nyckel': f[2], 'text': f[3]} for f in fr], 'paverkar': pv}
                        for n, rx, fr, pv in m.FOLJDREGLER],
        'hemligt': {'monster': m.HEMLIGT.pattern, 'flaggor': 'i'},
        # NEGATION (intervju.py sedan main e7c3bdf): en regelträff med negation i samma sats (inga . ; ! ? emellan) inom
        # 40 tecken före träffen ger ingen följdfråga utan bokförs som negerad; Kundstart speglar samma satsregel.
        'negation': ({'monster': m.NEGATION.pattern, 'flaggor': 'i', 'fonster': 40, 'satsgrans': '[.;!?]'} if hasattr(m, 'NEGATION') else None),
    }
    # Samma Unicode-läge som den levererade JavaScriptbanken. Ogiltiga Python-escapes
    # ska vägras här, inte fälla hela appmodulen vid nästa start.
    monster = [r['monster'] for r in ut['foljdregler']] + [ut['hemligt']['monster']]
    if ut['negation']:
        monster.append(re.sub(r'^\(\?i\)', '', ut['negation']['monster']))
    subprocess.run(['node', '-e', "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>JSON.parse(s).forEach(p=>new RegExp(p,'iu')));"], input=json.dumps(monster), text=True, check=True, capture_output=True)
    Path(a.ut).write_text(json.dumps(ut, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'grund': len(ut['grund']), 'foljdregler': len(ut['foljdregler']), 'sha256': ut['kalla']['sha256'][:12], 'git_rev': rev, 'ren': ut['kalla']['ren']}))


if __name__ == '__main__':
    main()
