async page => {
 const assert=(v,m)=>{if(!v)throw Error(m)};
 await page.setViewportSize({width:1600,height:1000});
 await page.context().addInitScript(()=>{
  if(location.origin!=='http://127.0.0.1:8766')return;
  const read=()=>JSON.parse(localStorage.getItem('b098-storage')||'{}');
  const area={get:async key=>({[key]:read()[key]}),set:async values=>localStorage.setItem('b098-storage',JSON.stringify({...read(),...values}))};
  window.browser={storage:{local:area,session:area}};
 });
 await page.goto('http://127.0.0.1:8766/reader.html');
 await page.locator('input[type=file]').setInputFiles('/tmp/B090/SAM.pdf');
 const zoom=page.locator('#toolbar-zoom-input');await zoom.waitFor();
 await page.waitForFunction(()=>!document.querySelector('#toolbar-zoom-input').disabled);
 const scale=async()=>parseFloat(await zoom.inputValue());
 const initial=await scale();
 const event=async (selector,init)=>page.locator(selector).first().evaluate((el,init)=>{const r=el.getBoundingClientRect();const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+Math.min(r.width/2,300),clientY:Math.max(150,r.top+150),...init});el.dispatchEvent(e);return e.defaultPrevented;},init);
 const dpr=await page.evaluate(()=>devicePixelRatio);
 assert(await event('.pdf-page',{ctrlKey:true,deltaY:-100}),'ctrl wheel default cancelled');
 await page.waitForFunction(n=>parseFloat(document.querySelector('#toolbar-zoom-input').value)>n,initial);
 await page.waitForTimeout(300);const enlarged=await scale();
 assert(!await event('.pdf-page',{deltaY:100}),'plain wheel not cancelled');
 assert(!await event('.reader-header',{ctrlKey:true,deltaY:-100}),'outside PDF untouched');
 await page.waitForTimeout(100);assert(await scale()===enlarged,'plain/outside scale unchanged');
 assert(await event('.pdf-page',{metaKey:true,deltaY:100}),'meta wheel cancelled');
 await page.waitForFunction(n=>parseFloat(document.querySelector('#toolbar-zoom-input').value)<n,enlarged);
 const reduced=await scale();
 await page.locator('.pdf-page').first().evaluate(el=>{for(let i=0;i<20;i++)el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-2,clientX:500,clientY:350}));});
 await page.waitForFunction(n=>parseFloat(document.querySelector('#toolbar-zoom-input').value)>n,reduced);
 await page.waitForTimeout(500);const pinched=await scale();
 assert(await page.evaluate(()=>devicePixelRatio)===dpr,'browser zoom unchanged');
 const persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem('b098-storage'))['reader-zoom:v1']);
 assert(persisted.mode==='manual'&&Math.round(persisted.scale*100)===pinched,'manual zoom persisted');
 return {initial,enlarged,reduced,pinched,plainWheelUntouched:true,outsideUntouched:true,browserZoomUnchanged:true,persisted};
}
