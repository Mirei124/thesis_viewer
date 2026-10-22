(() => {
 if(location.origin!=='http://127.0.0.1:8766')return;
 const defaults={'overview-auto-generate:v1':{threeLine:false,detailed:false},'model-config:v1':{baseUrl:'https://model.test/v1',model:'B100-test',structuredOutput:true,contextLimit:32000,outputLimit:32000}};
 const read=()=>({...defaults,...JSON.parse(localStorage.getItem('b100-storage')||'{}')});
 const area={get:async key=>({[key]:read()[key]}),set:async values=>localStorage.setItem('b100-storage',JSON.stringify({...read(),...values})),remove:async keys=>{const d=read();for(const k of Array.isArray(keys)?keys:[keys])delete d[k];localStorage.setItem('b100-storage',JSON.stringify(d))}};
 window.browser={storage:{local:area,session:area},permissions:{request:async()=>true,contains:async()=>true}};
 const real=window.fetch;window.__b100Calls=[];
 window.fetch=async(input,init)=>{
  if(String(input)!=='https://model.test/v1/chat/completions')return real(input,init);
  const body=JSON.parse(init.body),p=JSON.parse(body.messages.find(m=>m.role==='user').content);
  window.__b100Calls.push({section:p.section,kind:JSON.parse(body.messages.at(-1).content).kind,sources:p.newSources.length});
  if(p.section==='experiments_ablations')throw new TypeError('B100 simulated network failure');
  let content;
  if(p.section==='problem_motivation')content={status:'unavailable',text:'B100 model declined based on provided evidence.',sources:[]};
  else if(p.section==='method')content={status:'available',text:'B100 invalid alias [E999]',sources:['E999']};
  else if(p.section==='contributions_novelty')content='{bad json';
  else content={status:'not_applicable',text:'B100 not applicable.',sources:[]};
  return new Response(JSON.stringify({choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)}}]}),{status:200,headers:{'Content-Type':'application/json'}});
 };
})();
