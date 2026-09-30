"""B5: kontroll före Vercels autentisering. Kör bara den bundlade, hashbundna CLI:n."""
import hashlib
import json
import os
from pathlib import Path
import platform
import stat
import subprocess
import sys

PRIMAR = Path('/Users/elinhaggstrom/nortropic-repos/nortropic-kundstart')
# Ändring kräver ny låsfil, separat granskning och skyddad integration.
PINS = {'verktyg/vercel-cli/package.json': 'ed494af81aa4b618839d690c5ee3e39292b77d071b0f4c1aa9cdd5c9f5270d8f', 'verktyg/vercel-cli/package-lock.json': '0d2661007d3ef0232a63b3f08fc764edfebc8425b62f6fc49b2b70a545c669da', 'verktyg/vercel-cli/node_modules/@vercel/vc-native-darwin-arm64/bin/vercel': '5a2d2de7750e7d152ff44db352bbd53f479a1a4cbb7cdee52dbd302f5a5c6839'}
BINARY = 'verktyg/vercel-cli/node_modules/@vercel/vc-native-darwin-arm64/bin/vercel'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for part in iter(lambda: f.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()


def kontrollera(rot, pins=PINS, maskin=None):
    rot = Path(rot).absolute()
    if rot.resolve() != rot:
        raise ValueError('arbetsplatsen får inte vara en symlänk')
    if (maskin or (sys.platform, platform.machine())) != ('darwin', 'arm64'):
        raise ValueError('bara den kvalificerade Mac/arm64-binären stöds')
    for rel in ('verktyg/vercel-cli/package.json', 'verktyg/vercel-cli/package-lock.json', BINARY):
        p = rot / rel
        if p.resolve() != p or not stat.S_ISREG(p.stat().st_mode) or digest(p) != pins[rel]:
            raise ValueError('saknad eller ändrad CLI/låsfil: ' + rel)
    p = rot / BINARY
    if not os.access(p, os.X_OK) or p.stat().st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise ValueError('CLI:ns filrättigheter avviker')
    return p


def main(args=None):
    args = sys.argv[1:] if args is None else args
    try:
        if args not in (['--kontrollera'], ['deploy', '--prod']):
            raise ValueError('använd --kontrollera eller deploy --prod')
        rot = Path(__file__).resolve().parents[1]
        executable = kontrollera(rot)
        if args == ['--kontrollera']:
            print(json.dumps({'version': '60.0.1', 'lage': 'hashkontrollerad', 'autentisering': False}))
            return 0
        if rot != PRIMAR or Path.cwd().resolve() != PRIMAR:
            raise ValueError('driftsättning kräver primärutcheckningen')
        def git(*a):
            return subprocess.check_output(['git', *a], cwd=rot, text=True, env={'PATH': '/usr/bin:/bin'}).strip()
        if git('branch', '--show-current') != 'main' or git('status', '--porcelain', '--untracked-files=no'):
            raise ValueError('driftsättning kräver ren main')
        if git('rev-parse', 'HEAD') != git('rev-parse', 'origin/main'):
            raise ValueError('main måste motsvara återläst origin/main')
        # Först här får den verifierade leverantörskoden läsa sin inloggning/token.
        env = {k: v for k, v in os.environ.items() if k not in ('NODE_OPTIONS', 'NODE_PATH')}
        env['VERCEL_VC_NATIVE'] = '1'
        os.execve(executable, [str(executable), 'deploy', '--prod'], env)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as e:
        print('Vercel vägrad före autentisering: ' + str(e), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
