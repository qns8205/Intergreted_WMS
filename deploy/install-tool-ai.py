"""Install the already-verified trial model without altering inventory or other services."""
import hashlib
import json
import pathlib
import shutil
import subprocess

root = pathlib.Path('/home/configds/wms').resolve()
source = root / 'tmp-gemma-benchmark.TuC77R'
if root != pathlib.Path('/home/configds/wms') or not source.is_dir():
    raise RuntimeError('Expected verified benchmark artifacts')
model = source / 'embeddinggemma.gguf'
with model.open('rb') as handle:
    if hashlib.file_digest(handle, 'sha256').hexdigest() != 'b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63':
        raise RuntimeError('Model checksum mismatch')
target = root / 'ai'
target.mkdir(exist_ok=True)
shutil.copy2(model, target / 'embeddinggemma.gguf')
shutil.copytree(source / 'runtime', target / 'runtime', dirs_exist_ok=True)
unit = root / 'deploy/wms-tool-ai.service'
subprocess.run(['sudo', '-n', '/usr/bin/systemctl', 'link', str(unit)], check=True)
subprocess.run(['sudo', '-n', '/usr/bin/systemctl', 'daemon-reload'], check=True)
subprocess.run(['sudo', '-n', '/usr/bin/systemctl', 'enable', '--now', 'wms-tool-ai.service'], check=True)
# WMS only reads this opt-in switch; no migration or stock mutations.
config = root / 'server/data/tool-ai-config.json'
config.write_text(json.dumps({'enabled': True}) + '\n')
print('Local AI installed: one logical CPU equivalent, 2GiB, loopback only.')
