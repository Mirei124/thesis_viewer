import json,importlib.util,shutil
from pathlib import Path
P=Path('.local-cache/research/B106');spec=importlib.util.spec_from_file_location('ev',P/'evaluate.py');ev=importlib.util.module_from_spec(spec);spec.loader.exec_module(ev)
key='sam-followup--F_compact';path=P/'responses'/f'{key}.json';old=json.load(open(path));req=json.load(open(P/'requests'/f'{key}.json'));shutil.copy2(path,P/'responses'/f'{key}-firstpass.json')
ms=[*req['messages'],{'role':'assistant','content':old['content']},{'role':'user','content':'上一次响应不是可解析的JSON。请基于同一份原文重新回答上一轮原始问题，严格遵循system给出的JSON结构。不要输出Markdown围栏或JSON以外的内容。保留必要解释与原文来源，不要为了修复格式省略问题的子问。'}]
r=ev.call('sam-followup--F_repair',ms,'format-repair');final={**r,'key':key,'kind':'compact-final-repaired','repairSteps':[key+'-firstpass','sam-followup--F_repair'],'formatRepairCount':1};path.write_text(json.dumps(final,ensure_ascii=False,indent=2));print('repairparsed',isinstance(r.get('parsed'),dict))
