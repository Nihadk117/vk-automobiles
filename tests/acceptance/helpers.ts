import { test,expect } from "../auth-fixtures";
import type { Page,APIRequestContext,TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Snapshot } from "../../src/shared/shop";
export const origin="http://127.0.0.1:3100";
export async function command(request:APIRequestContext,action:string,data:unknown,key=randomUUID()){
  const r=await request.post("/api/shop",{headers:{Origin:origin},data:{action,data,requestId:key}});
  const result=await r.json();expect(r.ok(),JSON.stringify(result)).toBeTruthy();return result;
}
export async function seedPart(request:APIRequestContext,name:string,extra:Record<string,unknown>={}){
  const r=await request.post("/api/parts",{headers:{Origin:origin},data:{name,rack:"QA-A",openingQuantity:20,sellingPricePaise:28000,...extra}});
  expect(r.status()).toBe(201);return (await r.json()).part;
}
export async function shop(request:APIRequestContext):Promise<Snapshot>{return (await request.get("/api/shop")).json();}
export async function stock(request:APIRequestContext,id:number){const parts=(await(await request.get("/api/parts")).json()).parts;return parts.find((p:{id:number})=>p.id===id);}
export async function watch(page:Page){
  await page.addInitScript(()=>{
    document.addEventListener("DOMContentLoaded",()=>{
      const banner=document.createElement("div");banner.id="qa-watch-banner";
      banner.style.cssText="position:fixed;bottom:8px;left:8px;max-width:720px;z-index:2147483647;background:#123e35;color:#fff;padding:12px 18px;border:2px solid #d7e5b1;border-radius:8px;font:15px/1.4 Segoe UI,sans-serif;pointer-events:none;box-shadow:0 3px 20px #0003";
      banner.textContent=sessionStorage.getItem("qa-step")||"VK Automobiles · automated TEST copy · port 3100 · please watch without clicking";
      document.body.append(banner);
    });
  });
}
export async function step(page:Page,info:TestInfo,title:string,fn:()=>Promise<void>){
  await test.step(title,async()=>{
    console.log(`CHECK: ${title}`);
    if(page.url().startsWith(origin))await page.evaluate(label=>{sessionStorage.setItem("qa-step",label);const b=document.getElementById("qa-watch-banner");if(b)b.textContent=label;},`TEST: ${title}`);
    await fn();
    if(page.url().startsWith(origin))await page.evaluate(label=>{const b=document.getElementById("qa-watch-banner");if(b)b.textContent=label;},`PASS: ${title}`);
    await info.attach(title,{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
    // Deliberate demonstration pause, not a substitute for assertion-based waits.
    if(process.env.SHOP_QA_HEADLESS!=="1")await page.waitForTimeout(850);
    console.log(`PASS: ${title}`);
  });
}
export async function chooseLine(page:Page,id:number,name:string,quantity:string,price:string){
  await page.getByRole("combobox",{name:"Part",exact:true}).selectOption(String(id));
  await page.getByRole("button",{name:"Add line",exact:true}).click();
  await page.getByLabel(`Quantity for ${name}`).fill(quantity);await page.getByLabel(`Price for ${name}`).fill(price);
}
