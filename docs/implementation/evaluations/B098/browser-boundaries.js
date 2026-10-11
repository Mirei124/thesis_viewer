async page => {
 const assert=(v,m)=>{if(!v)throw Error(m)};
 const zoom=page.locator('#toolbar-zoom-input');
 await page.waitForFunction(()=>!document.querySelector('#toolbar-zoom-input').disabled);
 await zoom.fill('100');await zoom.press('Enter');await page.waitForTimeout(350);
 await page.evaluate(()=>window.scrollTo(0,400));await page.waitForTimeout(100);
 const point={x:700,y:450};
 const measure=async()=>page.locator('.pdf-page').first().evaluate((el,p)=>{const r=el.getBoundingClientRect();return{x:(p.x-r.left)/r.width,y:(p.y-r.top)/r.height,width:r.width,height:r.height}},point);
 const before=await measure();const initial=await zoom.inputValue();
 await page.mouse.move(point.x,point.y);await page.keyboard.down('Control');await page.mouse.wheel(0,-100);await page.keyboard.up('Control');
 await page.waitForFunction(v=>document.querySelector('#toolbar-zoom-input').value!==v,initial);await page.waitForTimeout(500);
 const after=await measure();assert(after.width>before.width,'PDF actual width grew');
 assert(Math.abs(after.y-before.y)<0.015,'vertical pointer anchor stable');
 const anchorErrorY=Math.abs(after.y-before.y);
 await page.locator('.pdf-page').first().evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-100000,cancelable:true,bubbles:true,clientX:700,clientY:450})));
 await page.waitForFunction(()=>document.querySelector('#toolbar-zoom-input').value==='400%');await page.waitForTimeout(250);
 await page.locator('.pdf-page').first().evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:100000,cancelable:true,bubbles:true,clientX:700,clientY:450})));
 await page.waitForFunction(()=>document.querySelector('#toolbar-zoom-input').value==='25%');await page.waitForTimeout(250);
 await page.locator('input[type=file]').setInputFiles('/tmp/B090/SAM.pdf');await page.waitForTimeout(700);
 assert(await zoom.inputValue()==='25%','new import restores preference');
 return {nativeCtrlWheel:true,actualWidthBefore:before.width,actualWidthAfter:after.width,anchorErrorY,bounds:[25,400],newImportPreference:true};
}
