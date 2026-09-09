"""Daily public weekly player feed; no roster/user data is published in this file."""
import concurrent.futures,datetime,hashlib,json,math,pathlib,statistics,urllib.request,os
ROOT=pathlib.Path(__file__).resolve().parent.parent
CACHE=pathlib.Path(os.environ.get('GX_CACHE','/tmp/guill-inputs'));CACHE.mkdir(exist_ok=True)
LEAGUE='1400972302392262656'
NOW=datetime.datetime.now(datetime.timezone.utc)

def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'DataDawgs guillotine research'}),timeout=45) as r:return json.load(r)
def endpoint(kind,season,week):return f'https://api.sleeper.app/{kind}/nfl/{season}/{week}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE'
def weights(league):return {k:v for k,v in league['scoring_settings'].items() if v!=0 and not __import__('re').match(r'^(def_|pts_allow|fg|xp|st_|sack$|int$|ff$|fum_rec$|safe$|blk_kick$)',k)}
def position(who):return next((p for p in [who.get('position')]+(who.get('fantasy_positions') or []) if p in ['QB','RB','WR','TE']),None)
def score(stats,w):return sum(stats.get(k,0)*v for k,v in w.items())
def write(name,data,source,note):
    env={'tier':'labs','tier_meaning':'Pup — live and useful, not yet validated. It may compute real answers and still have open questions about calibration, assumptions, data quality or edge. Everything starts here.','graded':False,'as_of':NOW.date().isoformat(),'built':NOW.date().isoformat(),'source':source,'note':note,'canonical_url':'https://datadawgs216.com/data/'+name,'data':data}
    (ROOT/'data'/name).write_text(json.dumps(env,separators=(',',':'),allow_nan=False)+'\n')

def build():
    league=fetch('https://api.sleeper.app/v1/league/'+LEAGUE);state=fetch('https://api.sleeper.app/v1/state/nfl');season=int(league['season']);week=max(1,min(18,int(state['display_week'])));w=weights(league)
    calibration_file=ROOT/'data/guillotine-calibration.json'
    existing=json.loads(calibration_file.read_text())['data'] if calibration_file.exists() else None
    if not existing or existing['season']!=season or existing['scoring']!=w:
        def historical(wk):
            result=[]
            for short,kind in [('hp','projections'),('hs','stats')]:
                path=CACHE/f'{short}-{season-1}-{wk}.json';legacy=CACHE/f'{short}-{wk}.json'
                if legacy.exists() and season==2026 and not path.exists():path.write_bytes(legacy.read_bytes())
                if not path.exists():path.write_text(json.dumps(fetch(endpoint(kind,season-1,wk))))
                result.append(json.loads(path.read_text()))
            return wk,result
        pools={};byTeam={};n=0;modifiedAfter=0
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            for wk,(projs,actual) in ex.map(historical,[1,3,5,7,9,11,13,15,17]):
                am={x['player_id']:x for x in actual}
                for p in projs:
                    a=am.get(p['player_id']);pos=position(p.get('player') or {})
                    if not a or pos not in ['QB','RB','WR','TE'] or not p.get('stats') or a.get('stats',{}).get('gp',0)<=0:continue
                    mu=score(p['stats'],w)
                    if mu<1:continue
                    err=score(a['stats'],w)-mu;bucket=pos+(':'+('high' if mu>=15 else 'mid' if mu>=7 else 'low'))
                    pools.setdefault(bucket,[]).append(err);pools.setdefault(pos,[]).append(err);byTeam.setdefault((wk,p.get('team')),[]).append((pos,err));n+=1
                    if p.get('last_modified',0)>int(datetime.datetime.fromisoformat(p['date']).replace(tzinfo=datetime.timezone.utc).timestamp()*1000):modifiedAfter+=1
        buckets={k:{'n':len(v),'sd':max(.5,math.sqrt(sum(x*x for x in v)/len(v))),'mean_error':statistics.mean(v)} for k,v in pools.items()}
        # Residual RMS, not hindsight bias correction. Small buckets shrink to the position pool.
        for k,b in buckets.items():
            if ':' in k:
                parent=buckets[k.split(':')[0]];b['sd']=math.sqrt((b['n']*b['sd']**2+40*parent['sd']**2)/(b['n']+40))
        products=[]
        for group in byTeam.values():
            for i,(p,e) in enumerate(group):
                for q,f in group[i+1:]:products.append((e/buckets[p]['sd'])*(f/buckets[q]['sd']))
        rho=max(0,min(.25,(statistics.mean(products) if products else 0)*len(products)/(len(products)+100)))
        existing={'season':season,'scoring':w,'buckets':buckets,'same_team_rho':rho,'pair_n':len(products),'sample_n':n,'history_season':season-1,'weeks':[1,3,5,7,9,11,13,15,17],'method':'Historical residual RMS by position and projected-score bucket, shrunk with 40 position observations; nonnegative same-team common factor capped at 0.25. Normal residuals. No fitted injury probability.','limitation':'Historical Sleeper projections can be revised after games. These are descriptive uncertainty estimates, not out-of-sample calibration. Correlation between opposing NFL teams and negative teammate correlations are not modeled.','possibly_revised_rows':modifiedAfter}
        write('guillotine-calibration.json',existing,'Sleeper 2025 weekly projections and actual statistics, scored for DawgPound Royale',existing['limitation'])
    projs=fetch(endpoint('projections',season,week));schedule=json.loads((ROOT/'data/nfl-schedule.json').read_text())['data']['games'];canon=lambda t:{'LA':'LAR','OAK':'LV','JAC':'JAX','WSH':'WAS'}.get(t,t);kick={}
    for g in schedule:
        if g['season']==season and g['week']==week and g.get('season_type')=='REG':
            for t in [g['home_team'],g['away_team']]:kick[canon(t)]=g['kickoff_at']
    players=[]
    for p in projs:
        who=p.get('player') or {};pos=position(who);st=p.get('stats')
        if pos not in ['QB','RB','WR','TE'] or st is None:continue
        tm=canon(p.get('team'));opp=canon(p.get('opponent'));start=kick.get(tm)
        if opp and not start:raise ValueError('Missing kickoff for '+str(tm))
        players.append({'id':p['player_id'],'name':((who.get('first_name')or'')+' '+(who.get('last_name')or'')).strip(),'position':pos,'positions':[p for p in (who.get('fantasy_positions') or [pos]) if p in ['QB','RB','WR','TE']],'team':tm,'opponent':opp,'injury':who.get('injury_status'),'kickoff':start,'updated_at':p.get('last_modified'),'stats':{k:v for k,v in st.items() if k in w},'has_projection':bool(st)})
    if sum(score(p['stats'],w)>0 for p in players)<150:raise ValueError('Weekly projection coverage too thin')
    out={'season':season,'week':week,'fetched_at':NOW.isoformat(),'source_url':endpoint('projections',season,week),'calibration':existing,'players':players,'model_version':'guillotine-weekly-v1'}
    write('guillotine-weekly.json',out,'Sleeper weekly NFL player projections; league-scored in the browser','Daily snapshot. Player timestamps are source update times. Projections are not live scores. Historical uncertainty is descriptive, not prospectively validated.')
    print(f'Weekly feed: {len(players)} players, week {week}; uncertainty sample {existing["sample_n"]}')
if __name__=='__main__':build()
