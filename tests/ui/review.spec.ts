import { test,expect } from "../auth-fixtures";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { SHOP_PROFILE } from "../../src/shared/shop-profile";
let saleId:number;
const pages=["home","inventory","sales","purchases","customers","suppliers","returns","reports","settings"];
test.beforeAll(async({request})=>{
  const headers={Origin:"http://127.0.0.1:3110"};
  async function run(action:string,data:unknown){const r=await request.post("/api/shop",{headers,data:{requestId:randomUUID(),action,data}});const result=await r.json();expect(r.ok(),JSON.stringify(result)).toBeTruthy();return result;}
  const response=await request.post("/api/parts",{headers,data:{name:"UI Air Filter",brand:"Bosch",partNumber:"AF-101",vehicle:"Maruti Suzuki Swift, Baleno",rack:"A-02",openingQuantity:10,sellingPricePaise:28000,purchaseCostPaise:18000,lowStockLevel:12}});
  expect(response.status()).toBe(201);const {part}=await response.json();
  const customer=await run("party",{kind:"customer",name:"UI Review Customer",phone:"0000000000",openingBalance:10000});
  const supplier=await run("party",{kind:"supplier",name:"UI Review Supplier",phone:"0000000000",openingBalance:20000});
  await run("document",{kind:"purchase",partyId:supplier.partyId,reference:"UI-PURCHASE",lines:[{partId:part.id,quantity:3,unitPrice:18000}],cash:40000});
  const sale=await run("document",{kind:"sale",partyId:customer.partyId,reference:"UI-SALE",lines:[{partId:part.id,quantity:2,unitPrice:28000}],upi:20000});saleId=sale.documentId;
  const state=await(await request.get("/api/shop")).json();const bill=state.documents.find((d:{id:number})=>d.id===saleId);
  await run("return",{documentId:saleId,reason:"Wrong fitment review",lines:[{lineId:bill.lines[0].id,quantity:1,saleable:true}]});
});
async function open(page:Page,section:string){
  await page.goto(section==="inventory"?"/":`/shop/${section}`);
  if(section==="inventory")await expect(page.getByRole("status")).toContainText("Local database connected");
  else await expect(page.getByRole("main")).toHaveAttribute("aria-busy","false");
}
async function expand(page:Page,section:string){
  if(section==="inventory")await page.getByRole("row").filter({hasText:"UI Air Filter"}).getByRole("button",{name:"Edit",exact:true}).click();
  if(section==="sales"||section==="purchases")await page.getByRole("button",{name:"View / print",exact:true}).first().click();
  if(section==="customers"||section==="suppliers")await page.getByRole("button",{name:"Account / payment",exact:true}).first().click();
  if(section==="returns")await page.getByRole("combobox",{name:"Original bill"}).selectOption(String(saleId));
}
test("all nine screens have consistent branding, readable controls and no page overflow",async({page},info)=>{
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:960});
    for(const section of pages){
      await test.step(`${width}px ${section}`,async()=>{
        await open(page,section);await expand(page,section);
        await expect(page.locator(".brand-type strong")).toHaveText("VK AutoMobiles");await expect(page.locator(".brand-type small")).toHaveText("Spare Parts");
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        if(section==="settings"){await expect(page.getByLabel("Address",{exact:true})).toHaveValue(SHOP_PROFILE.address);await expect(page.getByLabel("Phone",{exact:true})).toHaveValue(SHOP_PROFILE.phone);}
        const path=info.outputPath(`${width}-${section}.png`);await page.screenshot({path,fullPage:true});await info.attach(`${width}px ${section}`,{path,contentType:"image/png"});
      });
    }
  }
});
test("buttons and navigation have distinct hover, pressed, focus and disabled states",async({page},info)=>{
  await open(page,"inventory");const button=page.getByRole("button",{name:"Add a part"});
  const normal=await button.evaluate(e=>getComputedStyle(e).backgroundColor);await button.hover();
  await expect.poll(()=>button.evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe(normal);
  await button.focus();await page.keyboard.press("Shift+Tab");await page.keyboard.press("Tab");
  await expect(button).toBeFocused();expect(await button.evaluate(e=>e.matches(":focus-visible"))).toBe(true);
  expect(await button.evaluate(e=>parseFloat(getComputedStyle(e).outlineWidth))).toBeGreaterThanOrEqual(2);
  const box=(await button.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await expect.poll(()=>button.evaluate(e=>getComputedStyle(e).transform)).not.toBe("none");await page.mouse.up();
  await expect(page.getByRole("region",{name:"Add part"})).toBeVisible();
  await page.screenshot({path:info.outputPath("button-interactions.png"),fullPage:true});
  const link=page.getByRole("navigation").getByRole("link",{name:"Purchases",exact:true});await page.mouse.move(1000,100);
  const linkNormal=await link.evaluate(e=>getComputedStyle(e).backgroundColor);await link.hover();await expect.poll(()=>link.evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe(linkNormal);
  await open(page,"sales");const disabled=page.getByRole("button",{name:"Add line",exact:true});await expect(disabled).toBeDisabled();
  const disabledColor=await disabled.evaluate(e=>getComputedStyle(e).backgroundColor);await disabled.hover();expect(await disabled.evaluate(e=>getComputedStyle(e).cursor)).toBe("not-allowed");
  expect(await disabled.evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(disabledColor);
  await page.emulateMedia({reducedMotion:"reduce"});expect(await disabled.evaluate(e=>getComputedStyle(e).transitionDuration)).toBe("0s");
});
test("refresh and save actions show pending feedback and multiline address survives a save",async({page})=>{
  await open(page,"settings");await page.route("**/api/shop",async route=>{await new Promise(resolve=>setTimeout(resolve,400));await route.continue();});
  await page.getByRole("button",{name:"Refresh",exact:true}).click();await expect(page.getByRole("button",{name:"Refreshing...",exact:true})).toBeDisabled();await expect(page.getByRole("button",{name:"Refresh",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Save receipt details",exact:true}).click();await expect(page.getByRole("button",{name:"Saving...",exact:true})).toBeDisabled();await expect(page.getByRole("main").getByRole("status")).toContainText("Saved successfully");
  await page.reload();await expect(page.getByLabel("Address",{exact:true})).toHaveValue("Edavannapara, Malappuram\nPINCODE: 673645");
});
test("A4 receipt contains the supplied shop profile and hides interactive controls",async({page},info)=>{
  await open(page,"sales");await expand(page,"sales");const receipt=page.getByRole("region",{name:"Document details"});
  await expect(receipt.getByRole("heading",{name:"VK AutoMobiles",exact:true})).toBeVisible();
  await expect(receipt.locator(".receipt-category")).toHaveText("Spare Parts");await expect(receipt.locator(".receipt-address")).toHaveText(SHOP_PROFILE.address);
  await expect(receipt).toContainText("Phone: +917025724642");
  await page.emulateMedia({media:"print"});await expect(receipt).toBeVisible();await expect(page.getByRole("navigation")).toBeHidden();await expect(page.getByRole("button",{name:"Print A4",exact:true})).toBeHidden();
  await page.screenshot({path:info.outputPath("receipt-print-preview.png"),fullPage:true});
  const pdf=await page.pdf({path:info.outputPath("VK-AutoMobiles-A4-receipt.pdf"),format:"A4",preferCSSPageSize:true,printBackground:true});expect(pdf.subarray(0,4).toString()).toBe("%PDF");
});
