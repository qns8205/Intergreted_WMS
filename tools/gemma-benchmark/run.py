"""Read-only WMS probes + actual local Gemma inference, bounded background load."""
import concurrent.futures
import http.client
import json
import math
import os
import pathlib
import statistics
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = pathlib.Path(sys.argv[1]).resolve()
PORT = 18087
NODE = '/home/configds/.nvm/versions/node/v24.19.0/bin/node'
if ROOT.parent != pathlib.Path('/home/configds/wms') or not ROOT.name.startswith('tmp-gemma-benchmark.'):
    raise RuntimeError('Unexpected benchmark directory')
QUERIES = ['십자 드라이버', '망치', '나사를 조이는 도구', '육각 렌치', '줄자', '펜치', '전동 드릴', '종이를 자르는 칼', '볼트를 조일 공구', '접착 테이프']
processes = []
units = []
report = {'runtime':'llama.cpp b11333', 'model':'EmbeddingGemma 300M Q8_0', 'limits':{'cpuQuota':'100% (one logical CPU equivalent)', 'memoryMax':'2G', 'concurrency':1}, 'phases':[]}
def api(path, payload=None, timeout=3):
    req = urllib.request.Request(path, data=json.dumps(payload).encode() if payload is not None else None, headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)
def embed(text):
    response = api(f'http://127.0.0.1:{PORT}/v1/embeddings', {'input':text, 'model':'embeddinggemma', 'encoding_format':'float'}, timeout=8)
    vector = response['data'][0]['embedding']
    if len(vector) != 768 or not all(math.isfinite(v) for v in vector): raise RuntimeError('Invalid embedding')
    return vector
def stats(values):
    values = sorted(values)
    if not values: return {'count':0}
    return {'count':len(values), 'medianMs':round(statistics.median(values),2), 'p95Ms':round(values[max(0,math.ceil(len(values)*.95)-1)],2), 'maxMs':round(max(values),2)}
def cgroup_metrics(unit):
    raw = subprocess.check_output(['systemctl','--user','show',unit,'-p','MemoryCurrent','-p','MemoryPeak','-p','CPUUsageNSec','-p','CPUQuotaPerSecUSec','-p','MemoryMax'], text=True)
    result=dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
    pid=subprocess.check_output(['systemctl','--user','show',unit,'-p','MainPID','--value'],text=True).strip()
    try:
        for line in pathlib.Path(f'/proc/{pid}/status').read_text().splitlines():
            if line.startswith(('VmRSS:', 'VmHWM:')):
                key,value=line.split(':',1); result[key+'KiB']=int(value.strip().split()[0])
    except FileNotFoundError: pass
    return result
def system_snapshot():
    mem = dict(line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
    ffmpeg=subprocess.run(['pgrep','-af','ffmpeg.*v4l2'],capture_output=True,text=True).stdout
    return {'availableKiB':int(mem['MemAvailable'].split()[0]), 'swapUsedKiB':int(mem['SwapTotal'].split()[0])-int(mem['SwapFree'].split()[0]), 'loadAvg':pathlib.Path('/proc/loadavg').read_text().split()[:3], 'existingCameraActive':bool(ffmpeg.strip())}
def phase(name, seconds=25, inference=False, worker=None):
    stop = threading.Event()
    results = {'name':name, 'durationSeconds':seconds, 'errors':[], 'slowWarnings':[], 'systemBefore':system_snapshot()}
    query_ms = []
    probe_ms = {'inventory':[], 'status':[]}
    def probe(key, path):
        connection = http.client.HTTPConnection('127.0.0.1',3000,timeout=2)
        misses=0; slow_count=0
        try:
            while not stop.is_set():
                start=time.perf_counter()
                try:
                    connection.request('GET',path)
                    r=connection.getresponse(); data=r.read()
                    if r.status != 200 or not json.loads(data).get('success'): raise RuntimeError(f'HTTP {r.status}')
                    elapsed=(time.perf_counter()-start)*1000; probe_ms[key].append(elapsed)
                    misses=0
                    if elapsed>250: results['slowWarnings'].append(f'{key} slow: {elapsed:.1f}ms')
                    slow_count=slow_count+1 if elapsed>1000 else 0
                    if slow_count>=2: results['errors'].append(f'{key} repeatedly over 1 second'); stop.set()
                except Exception as e:
                    misses+=1; results['errors'].append(f'{key}: {e}'); connection.close()
                    connection=http.client.HTTPConnection('127.0.0.1',3000,timeout=2)
                    if misses>=2: stop.set()
                stop.wait(.15)
        finally: connection.close()
    def infer():
        n=0
        while not stop.is_set():
            started=time.perf_counter()
            try:
                embed('task: search result | query: '+QUERIES[n%len(QUERIES)])
                query_ms.append((time.perf_counter()-started)*1000)
            except Exception as e: results['errors'].append(f'inference: {e}'); stop.set()
            n+=1
    threads=[threading.Thread(target=probe,args=('inventory','/api/gas?action=getWarehouseInventoryOnly')), threading.Thread(target=probe,args=('status','/api/unattended/status'))]
    if inference: threads.append(threading.Thread(target=infer))
    if worker:
        def work():
            try: worker(stop)
            except Exception as e: results['errors'].append(f'worker: {e}')
            finally: stop.set()
        threads.append(threading.Thread(target=work))
    for t in threads: t.start()
    phase_started=time.perf_counter()
    stop.wait(seconds); stop.set()
    for t in threads: t.join(9)
    results.update({'wms':{k:stats(v) for k,v in probe_ms.items()}, 'inference':stats(query_ms), 'systemAfter':system_snapshot()})
    results['actualSeconds']=round(time.perf_counter()-phase_started,2)
    if inference or worker: results['modelService']=cgroup_metrics('wms-gemma-benchmark.service')
    if 'synthetic' in name:
        results['backgroundServices']={}
        for unit in ['wms-gemma-photo-benchmark.service','wms-gemma-video-benchmark.service']:
            state=subprocess.check_output(['systemctl','--user','show',unit,'-p','ActiveState','--value'],text=True).strip()
            results['backgroundServices'][unit]={'state':state,'resources':cgroup_metrics(unit)}
            if state!='active': results['errors'].append(unit+' was not active during combined test')
    report['phases'].append(results)
    (ROOT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(results,ensure_ascii=False),flush=True)
    if results['errors']: raise RuntimeError('Safety threshold or test error; stopping workload')

def start_unit(name, command, memory='2G', quota='100%'):
    log=ROOT/(name+'.log')
    args=['systemd-run','--user','--unit='+name,'--property=CPUQuota='+quota,'--property=MemoryMax='+memory,'--property=MemorySwapMax=0','--property=Nice=10','--property=RuntimeMaxSec=600','--property=StandardOutput=file:'+str(log),'--property=StandardError=file:'+str(log),'--setenv=OMP_NUM_THREADS=1','--setenv=OPENBLAS_NUM_THREADS=1']+command
    subprocess.run(args,check=True); units.append(name+'.service')

try:
    phase('baseline_without_model',20)
    server=next((ROOT/'runtime').rglob('llama-server'))
    start_unit('wms-gemma-benchmark',[str(server),'-m',str(ROOT/'embeddinggemma.gguf'),'--host','127.0.0.1','--port',str(PORT),'--embedding','--threads','1','--threads-batch','1','--parallel','1','--ctx-size','2048','--batch-size','2048','--ubatch-size','2048','--n-gpu-layers','0','--no-webui'])
    deadline=time.monotonic()+60
    while True:
        try:
            if api(f'http://127.0.0.1:{PORT}/health',timeout=1).get('status')=='ok': break
        except Exception: pass
        if time.monotonic()>deadline: raise RuntimeError('Model startup failed: '+(ROOT/'wms-gemma-benchmark.log').read_text()[-2500:])
        time.sleep(.5)
    t=time.perf_counter(); embed('task: search result | query: 십자 드라이버'); report['firstInferenceMs']=round((time.perf_counter()-t)*1000,2)
    phase('model_search_continuous',25,True)
    start_unit('wms-gemma-photo-benchmark',[NODE,str(ROOT/'photo-load.mjs')],memory='512M',quota='100%')
    start_unit('wms-gemma-video-benchmark',['/usr/bin/ffmpeg','-nostdin','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=800x600:rate=30','-vf','fps=8','-threads','1','-c:v','mjpeg','-q:v','10','-f','null','-'],memory='256M',quota='50%')
    phase('model_search_plus_synthetic_photo_video',30,True)
    subprocess.run(['systemctl','--user','stop','wms-gemma-photo-benchmark.service','wms-gemma-video-benchmark.service'],check=True)
    if '--quick' in sys.argv:
        sys.exit(0)
    # Real warehouse inventory stays on this server; only local inference receives item names.
    inventory=api('http://127.0.0.1:3000/api/gas?action=getWarehouseInventoryOnly')['inventory']
    items=[i for i in inventory if not i.get('archived')]
    vectors=[]; began=time.perf_counter()
    def index(stop):
        for i,item in enumerate(items):
            if stop.is_set(): raise RuntimeError('Indexing interrupted by safety monitor')
            text=f"title: {item['name']} | text: {item['name']} {item.get('spec','')} {item.get('keywords','')}"
            vectors.append(embed(text))
            if i%40==0: print(f'Indexed {i+1}/{len(items)} tools',flush=True)
            time.sleep(.04)
    phase('catalog_initial_indexing',180,worker=index)
    report['catalogIndex']={'count':len(items),'seconds':round(time.perf_counter()-began,2),'vectorBytesFloat32':len(items)*768*4}
    report['searchExamples']=[]
    for query in QUERIES:
        began=time.perf_counter(); query_vector=embed('task: search result | query: '+query)
        ranked=sorted(((sum(a*b for a,b in zip(query_vector,v)),item['name']) for item,v in zip(items,vectors)),reverse=True)[:5]
        report['searchExamples'].append({'query':query,'ms':round((time.perf_counter()-began)*1000,2),'top5':[{'name':name,'similarity':round(score,3)} for score,name in ranked]})
    print(json.dumps({'catalogIndex':report['catalogIndex'],'searchExamples':report['searchExamples']},ensure_ascii=False),flush=True)
finally:
    if units: subprocess.run(['systemctl','--user','stop']+units,check=False)
    report['modelStopped']=True
    report['wmsActive']=subprocess.check_output(['systemctl','is-active','wms'],text=True).strip()
    (ROOT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('Test workloads stopped; WMS='+report['wmsActive'],flush=True)
