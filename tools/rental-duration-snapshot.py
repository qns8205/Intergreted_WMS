"""Read-only production snapshot for rental-duration analysis; no app imports."""
import sqlite3, json, datetime, hashlib, collections, statistics, math

db = sqlite3.connect('file:/home/configds/wms/server/data/db.sqlite3?mode=ro', uri=True)
db.row_factory = sqlite3.Row
db.execute('BEGIN')
rows = []
for table in ['sid_rentals', 'general_rentals', 'tablecloth_rentals']:
    columns = {r[1] for r in db.execute('PRAGMA table_info(' + table + ')')}
    fields = ['id','borrow_date','applied_at','picked_up_at','returned','return_date','return_source','status','request_no','batch_id','item_id','item_label','qty','floor','unit','variant_id']
    selected = [f for f in fields if f in columns]
    for raw in db.execute('SELECT ' + ','.join(selected + [f for f in ['employee_id','borrower_name'] if f in columns]) + ' FROM ' + table):
        r = dict(raw)
        who = str(r.pop('employee_id', '') or r.get('borrower_name', ''))
        r.pop('borrower_name', None)
        r['person'] = hashlib.sha256(who.encode()).hexdigest()[:16]
        r['table'] = table
        rows.append(r)
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).replace(tzinfo=None)
def parse(value):
    if not value: return None
    text = str(value).strip()
    try:
        d = datetime.datetime.fromisoformat(text.replace('Z', '+00:00'))
        return d.astimezone(datetime.timezone(datetime.timedelta(hours=9))).replace(tzinfo=None) if d.tzinfo else d
    except ValueError: pass
    for fmt in ['%m/%d/%Y %H:%M:%S', '%m/%d/%Y %H:%M', '%m/%d/%Y']:
        try: return datetime.datetime.strptime(text, fmt)
        except ValueError: pass
    return None
def key(r):
    return (r['person'], str(r.get('request_no') or r.get('batch_id') or r.get('applied_at') or r.get('borrow_date') or r['table']+str(r['id'])))
siblings = collections.defaultdict(list)
for r in rows:
    p = parse(r.get('picked_up_at'))
    if p: siblings[key(r)].append(p)
excluded = collections.Counter()
closed, opened, legacy = [], [], []
for r in rows:
    src = r.get('return_source') or ''
    if src in ['cancel','pickup_timeout','transfer','swap','damage']:
        excluded[src] += 1
        continue
    p = parse(r.get('picked_up_at'))
    recovered = False
    if not p and r.get('returned') == 'O' and src in ['admin','self','unattended']:
        candidates = set(siblings[key(r)])
        if len(candidates) == 1: p = next(iter(candidates)); recovered = True
    back = parse(r.get('return_date'))
    start = p or parse(r.get('borrow_date')) or parse(r.get('applied_at'))
    if not start: excluded['missing_start'] += 1; continue
    r['start'], r['back'], r['recovered'] = start, back, recovered
    if r.get('returned') == 'O':
        if not back: excluded['missing_return_time'] += 1; continue
        hours = (back-start).total_seconds()/3600
        if hours < 0: excluded['negative_duration'] += 1; continue
        if back > now or start > now: excluded['future_time'] += 1; continue
        r['hours'] = hours
        if p: closed.append(r)
        else: legacy.append(r)
    elif p and start <= now:
        r['hours'] = (now-start).total_seconds()/3600
        opened.append(r)
    else: excluded['not_picked_up'] += 1
def stats(rs):
    a = sorted(r['hours'] for r in rs)
    if not a: return {'n':0}
    def q(p):
        i = (len(a)-1)*p; lo = math.floor(i); hi = math.ceil(i)
        return round(a[lo]+(a[hi]-a[lo])*(i-lo), 3)
    thresholds = [1,2,4,8,12,24,48,72,168,336]
    return {'n':len(a), 'mean_h':round(statistics.mean(a),3), 'p25_h':q(.25), 'median_h':q(.5), 'p75_h':q(.75), 'p80_h':q(.8), 'p90_h':q(.9), 'p95_h':q(.95), 'max_h':round(a[-1],3),
            'within':{str(t):sum(h<=t for h in a) for t in thresholds}, 'above':{str(t):sum(h>t for h in a) for t in thresholds}}
def period(rs, days): return [r for r in rs if r['start'] >= now-datetime.timedelta(days=days)]
def buckets(rs):
    bounds = [0,1,4,8,24,48,72,168,float('inf')]
    return [sum(lo <= r['hours'] < hi for r in rs) for lo,hi in zip(bounds,bounds[1:])]
def unitstats(rs):
    groups = collections.defaultdict(list)
    for r in rs: groups[str(r.get('floor') or '')+' / '+str(r.get('unit') or '')].append(r)
    return {k:stats(v) for k,v in sorted(groups.items(),key=lambda x:-len(x[1])) if len(v)>=10}
groups = collections.defaultdict(list)
for r in closed + opened: groups[key(r)].append(r)
sessions = []
for rs in groups.values():
    if all(r.get('returned') == 'O' for r in rs):
        start = min(r['start'] for r in rs)
        end = max(r['back'] for r in rs)
        sessions.append({'start':start,'back':end,'hours':(end-start).total_seconds()/3600})
result = {'as_of_kst':now.isoformat(), 'raw_rows':len(rows), 'table_counts':dict(collections.Counter(r['table'] for r in rows)),
 'excluded':dict(excluded), 'recovered_pickup_rows':sum(r['recovered'] for r in closed),
 'pickup_range':[min((r['start'] for r in closed+opened),default=now).isoformat(), max((r['start'] for r in closed+opened),default=now).isoformat()],
 'returned_verified':stats(closed), 'returned_legacy_application_based':stats(legacy), 'open_verified':stats(opened),
 'returned_buckets_0_1_4_8_24_48_72_168_inf':buckets(closed),
 'by_table':{t:{'closed':stats([r for r in closed if r['table']==t]),'open':stats([r for r in opened if r['table']==t])} for t in ['sid_rentals','general_rentals','tablecloth_rentals']},
 'periods':{str(d):{'completed_by_pickup':stats(period(closed,d)), 'completed_by_return':stats([r for r in closed if r['back']>=now-datetime.timedelta(days=d)]), 'open':stats(period(opened,d)), 'closed_request_groups':stats(period(sessions,d)), 'closed_request_groups_by_return':stats([r for r in sessions if r['back']>=now-datetime.timedelta(days=d)])} for d in [7,30,90]},
 'recent_30d_return_buckets':buckets([r for r in closed if r['back']>=now-datetime.timedelta(days=30)]),
 'recent_30d_return_people':len({r['person'] for r in closed if r['back']>=now-datetime.timedelta(days=30)}),
 'legacy_missing_pickup_sources':dict(collections.Counter(r.get('return_source') or '(empty)' for r in legacy)),
 'all_closed_request_groups':stats(sessions), 'units_30d':unitstats(period(closed,30)),
 'monthly':{month:stats([r for r in closed if r['start'].strftime('%Y-%m')==month]) for month in sorted(set(r['start'].strftime('%Y-%m') for r in closed))},
 'return_sources':dict(collections.Counter(r.get('return_source') or '(empty)' for r in rows))}
print(json.dumps(result, ensure_ascii=False, indent=2))
db.close()
