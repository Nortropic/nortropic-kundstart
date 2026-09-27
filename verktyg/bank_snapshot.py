#!/usr/bin/env python3
"""Snapshot av Digitalas frågebank ur verktyg/intervju.py (huvudspårets fil, ägs av nortropic-digitala) till
intervju-bank.json. Kundstart har inga egna intervjufrågor: id, texter, områden, prioriteter och följdregler kommer
härifrån och inget annat. Kvittot bär filens sha256 och git-revision så att avvikelse syns (verktyg/bank_kontroll.mjs).

    python3 -B verktyg/bank_snapshot.py --intervju /sökväg/nortropic-digitala/verktyg/intervju.py --ut intervju-bank.json
"""
import argparse, hashlib, importlib.util, json, re, subprocess
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
    a = p.parse_args()
    src = Path(a.intervju).resolve()
    data = src.read_bytes()
    spec = importlib.util.spec_from_file_location('intervju', src)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    rev = git(src.parent, 'rev-parse', 'HEAD')
    smuts = git(src.parent, 'status', '--porcelain', '--', str(src))
    gren = git(src.parent, 'branch', '--show-current')
    ut = {
        'schema': 'kundstart-bank/1',
        'kalla': {'fil': 'verktyg/intervju.py', 'repo': 'Nortropic/nortropic-digitala', 'sha256': hashlib.sha256(data).hexdigest(),
                  'git_rev': rev, 'gren': gren, 'ren': (smuts == '')},
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
    Path(a.ut).write_text(json.dumps(ut, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({'grund': len(ut['grund']), 'foljdregler': len(ut['foljdregler']), 'sha256': ut['kalla']['sha256'][:12], 'git_rev': rev, 'ren': ut['kalla']['ren']}))


if __name__ == '__main__':
    main()
