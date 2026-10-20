"""Compare on the server; return hashes and incoming line ranges, never production source."""
import pathlib, hashlib, json, difflib, sys
root=pathlib.Path('/home/configds/wms')
stage=pathlib.Path(sys.argv[1])
results=[]
for relative in json.loads((stage/'deploy/rental-policy-files.json').read_text())['files']:
    target=root/relative; incoming=stage/relative
    before=target.read_bytes() if target.exists() else b''
    after=incoming.read_bytes()
    old=before.decode('utf-8-sig').splitlines(); new=after.decode('utf-8-sig').splitlines()
    changes=[{'old_lines':[a+1,b],'incoming_lines':[c+1,d]} for tag,a,b,c,d in difflib.SequenceMatcher(None,old,new,autojunk=False).get_opcodes() if tag!='equal']
    results.append({'path':relative,'exists':target.exists(),'before_sha256':hashlib.sha256(before).hexdigest() if target.exists() else None,'after_sha256':hashlib.sha256(after).hexdigest(),'changes':changes})
(stage/'deploy/expected-production-hashes.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
