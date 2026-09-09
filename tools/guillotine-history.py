"""Aggregate Case's prior-season completed auctions; publish no ownership or raw rosters."""
import concurrent.futures,datetime,json,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent.parent
DEST=ROOT/'data/guillotine-market-history.json'
CASE='1389344040964599808'
def get(url):
    with urllib.request.urlopen(url,timeout=45) as r:return json.load(r)
def main():
    current=get('https://api.sleeper.app/v1/league/'+CASE);previous=current.get('previous_league_id')
    if not previous:raise ValueError('No verified prior league link')
    if DEST.exists() and json.loads(DEST.read_text())['data']['history_league_id']==previous:
        print('Historical market reference already collected');return
    league=get('https://api.sleeper.app/v1/league/'+previous)
    if int(league['season'])>=int(current['season']):raise ValueError('History is not a prior season')
    budget=league['settings']['waiver_budget'];groups={};winners=0;zero=0
    def week(w):return w,get(f'https://api.sleeper.app/v1/league/{previous}/transactions/{w}')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for w,tx in ex.map(week,range(1,19)):
            for t in tx:
                if t.get('type')!='waiver' or t.get('status')!='complete' or not t.get('adds') or t.get('settings',{}).get('waiver_bid') is None:continue
                bid=float(t['settings']['waiver_bid'])
                if bid<0 or bid>budget:raise ValueError('Invalid historical bid')
                stage='Early (W1–6)' if w<=6 else 'Middle (W7–12)' if w<=12 else 'Late (W13–18)'
                groups.setdefault(stage,[]).append(bid/budget);winners+=1;zero+=bid==0
    def q(a,p):return sorted(a)[int((len(a)-1)*p)]
    data={'reference_league_id':CASE,'history_league_id':previous,'season':int(league['season']),'name':league['name'],'starting_faab':budget,'reception_points':league['scoring_settings'].get('rec',0),'teams':league['total_rosters'],'completed_winning_bids':winners,'zero_dollar_wins':zero,'stages':[{'stage':s,'n':len(a),'p25_fraction':q(a,.25),'median_fraction':q(a,.5),'p75_fraction':q(a,.75),'max_fraction':max(a)} for s,a in groups.items()],'limitations':'Separate league and season. Completed winning bids only, not losing bids or winning probabilities. Positions and player quality are not matched; stage summaries are context, not target-specific prices. Fractions use the original FAAB budget, not current remaining cash.'}
    now=datetime.datetime.now(datetime.timezone.utc).isoformat();DEST.write_text(json.dumps({'tier':'labs','tier_meaning':'Pup — live and useful, not yet validated. It may compute real answers and still have open questions about calibration, assumptions, data quality or edge. Everything starts here.','graded':False,'as_of':now[:10],'built':now,'source':f'Sleeper previous_league_id chain from {CASE}; completed 2025 waiver transactions for {previous}','note':data['limitations'],'canonical_url':'https://datadawgs216.com/data/guillotine-market-history.json','data':data},indent=2)+'\n');print(json.dumps(data,indent=2))
if __name__=='__main__':main()
