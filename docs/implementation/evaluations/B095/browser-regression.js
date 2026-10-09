async page => {
 const assert=(v,m)=>{if(!v)throw Error(m)};
 await page.setViewportSize({width:1600,height:1000});
 await page.context().addInitScript(()=>{
  if(location.origin !== 'http://127.0.0.1:8765') return;
  const defaults={'overview-auto-generate:v1':{threeLine:false,detailed:false},'model-config:v1':{baseUrl:'https://model.test/v1',model:'B095-test',structuredOutput:true,contextLimit:128000,outputLimit:32000}};
  const read=()=>({...defaults,...JSON.parse(localStorage.getItem('b095-storage')||'{}')});
  const area={get:async key=>({[key]:read()[key]}),set:async values=>localStorage.setItem('b095-storage',JSON.stringify({...read(),...values})),remove:async keys=>{const d=read();for(const k of Array.isArray(keys)?keys:[keys])delete d[k];localStorage.setItem('b095-storage',JSON.stringify(d))}};
  window.browser={storage:{local:area,session:area},permissions:{request:async()=>true,contains:async()=>true}};
 });
 await page.context().unroute('https://model.test/v1/chat/completions');
 let calls=[],malformed=false;
 await page.context().route('https://model.test/v1/chat/completions',async route=>{
  const b=route.request().postDataJSON(),first=JSON.parse(b.messages.find(m=>m.role==='user').content),last=JSON.parse(b.messages.at(-1).content);
  calls.push({section:first.section,kind:last.kind||'initial',chars:first.newSources.reduce((n,s)=>n+s.excerpt.length,0)});
  const alias=first.newSources.find(s=>s.excerpt.length>100)?.alias||first.newSources[0].alias;
  const content=malformed&&first.section==='method'&&last.kind==='evidence_increment'?'{bad json':JSON.stringify({status:'available',text:'模块处理输入并生成输出 ['+alias+']',sources:[alias]});
  await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:100,completion_tokens:100}})});
 });
 await page.goto('http://127.0.0.1:8765/options.html');
 const checkbox=page.locator('#semanticReview');await checkbox.waitFor();assert(!await checkbox.isChecked(),'old config default off');
 await checkbox.check();await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.reload();assert(await checkbox.isChecked(),'saved enabled');
 await checkbox.uncheck();await page.getByRole('button',{name:'Save settings',exact:true}).click();
 await page.goto('http://127.0.0.1:8765/reader.html');await page.locator('input[type=file]').setInputFiles('/tmp/B090/SAM.pdf');
 const generate=page.getByRole('button',{name:/^(Generate|Regenerate) detailed overview$/});await generate.click();await page.waitForSelector('.detailed-overview-section');await page.waitForTimeout(200);
 assert(calls.length===5,'default five requests');const firstRun=[...calls];
 const options=await page.context().newPage();await options.goto('http://127.0.0.1:8765/options.html');await options.locator('#semanticReview').check();await options.getByRole('button',{name:'Save settings',exact:true}).click();await options.close();await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(300);
 calls=[];await generate.click();await page.waitForSelector('.detailed-overview-section');await page.waitForTimeout(200);assert(calls.length===6,'enabled six requests');assert(calls.filter(c=>c.kind==='method_semantic_review').length===1,'one semantic review');const enabledRun=[...calls];
 await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('b095-storage'));d['model-config:v1'].semanticReview=false;localStorage.setItem('b095-storage',JSON.stringify(d));window.dispatchEvent(new Event('focus'));});await page.waitForTimeout(300);
 malformed=true;calls=[];await generate.click();await page.waitForSelector('.detailed-overview-section');await page.waitForTimeout(200);assert(calls.length===6,'one repair even when review off '+JSON.stringify(calls));assert(calls.filter(c=>c.kind==='detailed_format_repair').length===1,'format repair');assert(!calls.some(c=>c.kind==='method_semantic_review'),'no semantic request');
 await page.locator('.detailed-overview-section .inline-evidence-button').nth(1).click();assert((await page.getByRole('dialog').innerText()).length>80,'source popup');await page.keyboard.press('Escape');
 return {firstRun,enabledRun,repairRun:calls,persisted:true,focusRefresh:true,sourcePopup:true};
}
