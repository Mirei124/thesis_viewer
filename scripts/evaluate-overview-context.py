#!/usr/bin/env python3
"""B090 research runner; credentials stay in environment; raw request files stay local.
Usage: DS_API_KEY=... python3 scripts/evaluate-overview-context.py REQUEST_DIR OUTPUT_DIR
A=production prompt/input; B=new prompt/same input and history; C=new prompt/full sections.
"""
import concurrent.futures, hashlib, json, os, sys, time, urllib.request
from pathlib import Path
output = None
def call(name, arm, messages, output_limit=12000):
 path=output/f'{name}-{arm}.json'
 if path.exists(): return json.loads(path.read_text())
 body={'model':'deepseek-flash','messages':messages,'max_tokens':output_limit,'temperature':0,'response_format':{'type':'json_object'}}
 encoded=json.dumps(body,ensure_ascii=False).encode()
 req=urllib.request.Request('https://api.deepseek.com/v1/chat/completions',data=encoded,headers={'Authorization':'Bearer '+os.environ['DS_API_KEY'],'Content-Type':'application/json'})
 start=time.monotonic()
 try:
  with urllib.request.urlopen(req,timeout=300) as r: result=json.load(r)
  choice=result['choices'][0]; content=choice['message']['content']
  try: parsed=json.loads(content); parse_error=None
  except (ValueError,TypeError) as e: parsed={};parse_error=str(e)
  allowed=set()
  for m in messages:
   if m['role']=='user':
    try:
     p=json.loads(m['content']);allowed.update(p.get('legalSourceAliases',[]));allowed.update(s['alias'] for s in p.get('newSources',[]))
    except (ValueError,KeyError):pass
  record={'paper':name,'arm':arm,'model':result.get('model'),'requestSha256':hashlib.sha256(encoded).hexdigest(),'outputLimit':output_limit,'requestChars':sum(len(m['content']) for m in messages),'elapsedSeconds':round(time.monotonic()-start,2),'usage':result.get('usage'),'finishReason':choice.get('finish_reason'),'content':content,'parsed':parsed,'parseError':parse_error,'unknownAliases':sorted(set(parsed.get('sources',[]))-allowed)}
  path.write_text(json.dumps(record,ensure_ascii=False,indent=2)); print(name,arm,record['elapsedSeconds'],record['usage'].get('prompt_tokens'),flush=True);return record
 except Exception as e:
  print(name,arm,'ERROR',type(e).__name__,str(e),flush=True);raise

def run(path):
 task=json.loads(path.read_text());name=task['name']
 p=call(name,'problem',task['problem'])
 history=[task['problem'][-1],{'role':'assistant','content':p['content']}]
 for arm in ['A','B']:
  base=task[arm];call(name,arm,[base[0],*history,*base[1:]])
 call(name,'C',task['C'])
if __name__ == '__main__':
 source, output = map(Path,sys.argv[1:3]); output.mkdir(parents=True,exist_ok=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  futures=[pool.submit(run,p) for p in sorted(source.glob('*.json'))]
  for f in futures:f.result()
