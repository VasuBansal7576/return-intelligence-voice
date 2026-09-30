"""Create a reproducible source checkpoint without local secrets or visitor data."""
from pathlib import Path
import hashlib,json,tarfile,datetime
root=Path(__file__).resolve().parents[1]
base=Path('/workspace/shared/return-intelligence-voice-source')
out=Path('/workspace/shared/return-voice-checkpoints');out.mkdir(exist_ok=True)
now=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
excluded={'.private','node_modules','.git','.env','.eve','.vercel','.next','.output','.nitro','dist','.firecrawl','__pycache__'}
files=[]
for path in sorted(root.rglob('*')):
 if not path.is_file() or path.is_symlink():continue
 rel=path.relative_to(root)
 if any(part in excluded or part.startswith('.env') for part in rel.parts):continue
 if str(rel).startswith('agent/data/'):continue
 if rel.parts[0]=='data' and str(rel) not in {'data/evaluation-results.json','data/build-manifest.json'}:continue
 if str(rel).startswith('frontend/qa/') and path.suffix not in {'.mjs','.js','.md'}:continue
 if str(rel).startswith('frontend/qa/tmp/'):continue
 if path.name=='RECOVERY_MANIFEST.json' or path.suffix in {'.log','.png','.mp4','.webm','.tgz','.gz','.zip'}:continue
 files.append(path)
rows=[]
for path in files:
 rel=str(path.relative_to(root));old=base/rel;blob=path.read_bytes();sha=hashlib.sha256(blob).hexdigest()
 rows.append({'path':rel,'bytes':len(blob),'sha256':sha,'change':'added' if not old.is_file() else 'unchanged' if old.read_bytes()==blob else 'modified'})
report=json.loads((root/'data/evaluation-results.json').read_text())
manifest={'createdAt':now,'repository':'https://github.com/VasuBansal7576/return-intelligence-voice','baseBranch':'fm/riv-base-v1','baseCommit':'deac6db6b7dd9984a1636b03a5d376b914010238','checkpointState':'local source, not pushed or deployed','evaluation':{'summary':report['summary'],'sourceIntegrity':report['sourceIntegrity']},'excluded':'Dependencies, environment files, credentials, local visitor records, raw scrape captures, videos, and rendered screenshots','files':rows}
manifest_path=root/'RECOVERY_MANIFEST.json';manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
archive=out/f'return-intelligence-voice-source-{now}.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
 for path in files+[manifest_path]:tar.add(path,arcname=f'return-intelligence-voice/{path.relative_to(root)}',recursive=False)
with tarfile.open(archive,'r:gz') as tar:
 members=tar.getmembers()
 for m in members:
  rel=m.name.removeprefix('return-intelligence-voice/')
  if rel=='RECOVERY_MANIFEST.json':continue
  expected=next(row for row in rows if row['path']==rel)
  actual=tar.extractfile(m).read()
  assert hashlib.sha256(actual).hexdigest()==expected['sha256'],rel
 assert not any('/.private/' in m.name or '/node_modules/' in m.name or '/.env' in m.name or m.name.endswith('/records.jsonl') for m in members)
summary={'archive':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'files':len(rows)+1,'baseCommit':manifest['baseCommit'],'cases':report['summary'],'aggregateSourceSha256':report['sourceIntegrity'].get('aggregateSha256')}
(out/'latest.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
