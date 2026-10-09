async page => {
 const assert=(v,m)=>{if(!v)throw Error(m)};
 await page.setViewportSize({width:1600,height:1000});
 await page.context().addInitScript(()=>{
  if(location.origin !== 'http://127.0.0.1:8766') return;
  const defaults={'overview-auto-generate:v1':{threeLine:false,detailed:false},'model-config:v1':{baseUrl:'https://model.test/v1',model:'B097-test',structuredOutput:true,contextLimit:128000,outputLimit:32000}};
  const read=()=>({...defaults,...JSON.parse(localStorage.getItem('b097-storage')||'{}')});
  const area={get:async key=>({[key]:read()[key]}),set:async values=>localStorage.setItem('b097-storage',JSON.stringify({...read(),...values})),remove:async keys=>{const d=read();for(const k of Array.isArray(keys)?keys:[keys])delete d[k];localStorage.setItem('b097-storage',JSON.stringify(d))}};
  window.browser={storage:{local:area,session:area},permissions:{request:async()=>true,contains:async()=>true}};
 });

 let release; let calls=0;
 await page.context().route('https://model.test/v1/chat/completions',async route=>{
  const b=route.request().postDataJSON(),p=JSON.parse(b.messages.find(m=>m.role==='user').content);
  calls++;
  if(p.section==='method') await new Promise(resolve=>{release=resolve});
  const alias=p.newSources.find(s=>s.excerpt.length>100)?.alias||p.newSources[0].alias;
  try { await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({status:'available',text:'已完成 '+p.section+' ['+alias+']',sources:[alias]})}}]})}); } catch {}
 });
 await page.goto('http://127.0.0.1:8766/reader.html');
 await page.locator('input[type=file]').setInputFiles('/tmp/B090/SAM.pdf');
 const generate=page.getByRole('button',{name:/^(Generate|Regenerate) detailed overview$/});
 await generate.click();
 await page.getByText('已完成 problem_motivation',{exact:false}).waitFor();
 assert(await page.locator('.detailed-overview-section').count()===1,'only first section visible');
 assert(await generate.isDisabled(),'still generating');
 await page.locator('.detailed-overview-section .inline-evidence-button').first().click();
 assert((await page.getByRole('dialog').innerText()).length>80,'source works while generating');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert(await page.locator('.detailed-overview-section').count()===1,'cancel preserves first section');
 assert(await generate.isEnabled(),'can retry');
 if(release) release();
 await page.waitForTimeout(300);
 assert(await page.locator('.detailed-overview-section').count()===1,'late response ignored');
 await generate.click();
 await page.getByText('已完成 problem_motivation',{exact:false}).waitFor();
 await page.waitForTimeout(300);
 release();
 await page.getByText('已完成 limitations',{exact:false}).waitFor();
 assert(await page.locator('.detailed-overview-section').count()===5,'all sections shown');
 assert(await generate.isEnabled(),'generation finished');
 return {firstSectionVisibleBeforeMethod:true,liveSourcePopup:true,cancelPreserves:true,lateResponseIgnored:true,allFiveComplete:true,calls};
}
