"""Isolated official runtime/model download; no system installation."""
import hashlib
import json
import pathlib
import subprocess
import sys
import tarfile
import urllib.request

root = pathlib.Path(sys.argv[1]).resolve()
if root.parent != pathlib.Path('/home/configds/wms') or not root.name.startswith('tmp-gemma-benchmark.'):
    raise RuntimeError('Unexpected benchmark directory')
def download(url, target):
    subprocess.run(['curl', '-fLsS', '--connect-timeout', '20', '--max-time', '240', '--retry', '1', '--limit-rate', '6M', '-o', str(target), url], check=True)
def checksum(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()
with urllib.request.urlopen('https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b11333', timeout=20) as response:
    release = json.load(response)
asset = next(a for a in release['assets'] if a['name'] == 'llama-b11333-bin-ubuntu-x64.tar.gz')
print('Downloading official CPU runtime', flush=True)
archive = root / 'runtime.tar.gz'
download(asset['browser_download_url'], archive)
expected = asset.get('digest', '').removeprefix('sha256:')
if not expected or checksum(archive) != expected: raise RuntimeError('Runtime checksum mismatch')
with tarfile.open(archive) as tar: tar.extractall(root / 'runtime', filter='data')
print('Downloading EmbeddingGemma Q8 model (334 MB)', flush=True)
model = root / 'embeddinggemma.gguf'
download('https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf', model)
if checksum(model) != 'b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63': raise RuntimeError('Model checksum mismatch')
servers = list((root / 'runtime').rglob('llama-server'))
if len(servers) != 1: raise RuntimeError('Cannot uniquely identify runtime')
print(json.dumps({'root':str(root), 'server':str(servers[0]), 'model':str(model), 'runtimeSha256':expected}), flush=True)
