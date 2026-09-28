"""Verkliga lokala Git-prover; ingen extern repoändring."""
import json, pathlib, subprocess, tempfile, unittest
SCRIPT = pathlib.Path(__file__).resolve().parents[2] / 'verktyg/bank_snapshot.py'
class SnapshotTest(unittest.TestCase):
    def test_revision_and_worktree_are_independent(self):
        with tempfile.TemporaryDirectory() as td:
            root=pathlib.Path(td); (root/'verktyg').mkdir()
            src=root/'verktyg/intervju.py'; out=root/'bank.json'
            original='import re\nPER_OMGANG=8\nSTATUSAR=[]\nOMRADEN={}\nGRUND=[]\nFOLJDREGLER=[]\nHEMLIGT=re.compile("hemligt")\n'
            src.write_text(original)
            def git(*args):return subprocess.run(['git','-C',td,*args],check=True,capture_output=True,text=True).stdout.strip()
            git('init','-b','main');git('add','.');git('-c','user.name=Test','-c','user.email=test@example.test','commit','-m','synthetic source')
            rev=git('rev-parse','HEAD')
            def run(*args):return subprocess.run(['python3','-B',str(SCRIPT),'--intervju',str(src),'--ut',str(out),*args],capture_output=True,text=True)
            self.assertEqual(run('--rev',rev,'--gren','main').returncode,0)
            k=json.loads(out.read_text())['kalla'];self.assertTrue(k['ren']);self.assertTrue(k['revision_verifierad'])
            src.write_text(original+'# uncommitted change\n')
            self.assertNotEqual(run('--rev',rev,'--gren','main').returncode,0)
            self.assertEqual(run().returncode,0)
            k=json.loads(out.read_text())['kalla'];self.assertFalse(k['ren']);self.assertFalse(k['revision_verifierad'])
            src.write_text(original)
            self.assertNotEqual(run('--rev','0'*40).returncode,0)
            self.assertNotEqual(run('--rev',rev,'--gren','invented').returncode,0)
            exported=root/'exported.py';exported.write_text(original)
            r=subprocess.run(['python3','-B',str(SCRIPT),'--intervju',str(exported),'--ut',str(out),'--repo',td,'--rev',rev,'--gren','main'],capture_output=True,text=True)
            self.assertEqual(r.returncode,0)
            k=json.loads(out.read_text())['kalla'];self.assertIsNone(k['ren']);self.assertTrue(k['revision_verifierad'])
if __name__=='__main__':unittest.main()
