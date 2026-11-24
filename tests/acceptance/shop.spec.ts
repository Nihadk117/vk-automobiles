import { signIn } from "../auth-fixtures";
import { test,expect } from "../auth-fixtures";
import { readFileSync } from "node:fs";
import { watch,step,command,seedPart,shop,stock,chooseLine,origin } from "./helpers";

test.beforeEach(async({page})=>watch(page));

test("Inventory — add, search, edit, duplicate warning, recount and history",async({page,request},info)=>{
  const name=`QA Air filter ${Date.now()}`;let id=0;
  await step(page,info,"Add a part with vehicles, rack, opening stock and an unknown purchase cost",async()=>{
    await page.goto("/");await expect(page.getByRole("status")).toContainText("Local database connected");
    await page.getByRole("button",{name:"Add a part"}).click();
    await page.getByLabel("Part name",{exact:true}).fill(name);await page.getByLabel("Brand (optional)").fill("QA Brand");
    await page.getByLabel("Part number (optional)").fill("QA-AF-01");await page.getByLabel("Compatible vehicles").fill("Swift, Baleno");
    await page.getByLabel("Rack",{exact:true}).fill("QA-A1");await page.getByLabel("Opening quantity").fill("10");
    await page.getByLabel("Selling price").fill("280.25");await page.getByRole("checkbox").check();
    await page.getByRole("button",{name:"Save part & stock",exact:true}).click();
    await expect(page.getByRole("cell",{name:name,exact:false})).toBeVisible();
    const all=(await(await request.get("/api/parts")).json()).parts;const created=all.find((p:{name:string})=>p.name===name);id=created.id;
    expect(created).toMatchObject({quantity:10,purchaseCostPaise:null,sellingPricePaise:28025,vehicle:"Swift, Baleno"});
  });
  await step(page,info,"Search by manufacturer number and rack; edit price and details without changing stock",async()=>{
    await page.getByRole("searchbox").fill("QA-AF-01");const row=page.getByRole("row").filter({hasText:name});await expect(row).toBeVisible();
    await row.getByRole("button",{name:"Edit",exact:true}).click();await page.getByLabel("Selling price").fill("315.50");
    await page.getByLabel("Purchase cost").fill("175.50");await page.getByLabel("Low-stock level").fill("9");await page.getByLabel("Rack",{exact:true}).fill("QA-B2");
    await page.getByRole("button",{name:"Save changes",exact:true}).click();await expect(row).toContainText("315.50");
    expect(await stock(request,id)).toMatchObject({quantity:10,purchaseCostPaise:17550,rack:"QA-B2"});
    await page.getByRole("searchbox").fill("QA-B2");await expect(row).toBeVisible();
  });
  await step(page,info,"Correct the count to eight; show low-stock warning and retained history",async()=>{
    const row=page.getByRole("row").filter({hasText:name});await row.getByRole("button",{name:"Adjust stock",exact:true}).click();
    await page.getByLabel("Counted quantity").fill("8");await page.getByLabel("Reason for correction").fill("QA recount: two damaged pieces");
    await page.getByRole("button",{name:"Record adjustment",exact:true}).click();await expect(row).toContainText("8 pieces");await expect(row).toContainText("Low stock");
    await row.getByRole("button",{name:"History",exact:true}).click();await expect(page.getByRole("region",{name:"Part history"})).toContainText("two damaged pieces");
    await expect(page.getByRole("region",{name:"Part history"})).toContainText("Selling price:");
  });
  await step(page,info,"Warn about duplicate parts; reject invalid quantities; preserve the saved record on reload",async()=>{
    await page.getByRole("button",{name:"Add a part"}).click();await page.getByLabel("Part name",{exact:true}).fill(name);await page.getByLabel("Brand (optional)").fill("QA Brand");
    await expect(page.getByText(/A similar name\/brand/)).toBeVisible();await page.getByRole("button",{name:"Cancel",exact:true}).click();
    const invalid=await request.post("/api/parts",{headers:{Origin:origin},data:{name:"Invalid",rack:"QA",openingQuantity:-1,sellingPricePaise:10}});expect(invalid.status()).toBe(400);
    await page.reload();await page.getByRole("searchbox").fill(name);await expect(page.getByRole("row").filter({hasText:name})).toContainText("8 pieces");
  });
});

test("Accounts — customer/supplier creation, opening debts, overpayment guard and contact editing",async({page,request},info)=>{
  const tag=Date.now(),customer=`QA customer ${tag}`,supplier=`QA supplier ${tag}`;let customerId=0;
  await step(page,info,"Create customer with a 100-rupee opening balance",async()=>{
    await page.goto("/shop/customers");await page.getByLabel("Name",{exact:true}).fill(customer);await page.getByLabel("Phone (optional)").fill("0000000000");
    await page.getByLabel("Opening amount owed").fill("100");await page.getByRole("button",{name:"Add account",exact:true}).click();
    const row=page.getByRole("row").filter({hasText:customer});await expect(row).toContainText("100.00");
    customerId=(await shop(request)).parties.find(p=>p.name===customer)!.id;await row.getByRole("button",{name:"Account / payment"}).click();
  });
  await step(page,info,"Reject an overpayment, then clear the opening debt using cash plus UPI",async()=>{
    await page.getByLabel("Cash (₹)",{exact:true}).fill("101");await page.getByRole("button",{name:"Record collection",exact:true}).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("exceeds the outstanding");expect((await shop(request)).parties.find(p=>p.id===customerId)?.balance).toBe(10000);
    await page.getByLabel("Cash (₹)",{exact:true}).fill("40");await page.getByLabel("UPI (₹)",{exact:true}).fill("60");
    await page.getByRole("button",{name:"Record collection",exact:true}).click();await expect(page.getByRole("heading",{name:`${customer} · ₹0.00 outstanding`})).toBeVisible();
  });
  await step(page,info,"Correct contact details and retain the original account document",async()=>{
    await page.getByLabel("Account name",{exact:true}).fill(customer+" corrected");await page.getByLabel("Account phone",{exact:true}).fill("1111111111");
    await page.getByRole("button",{name:"Update contact details",exact:true}).click();
    await expect(page.getByRole("heading",{name:`${customer} corrected · ₹0.00 outstanding`})).toBeVisible();
    expect((await shop(request)).documents.find(d=>d.partyId===customerId)?.partyName).toBe(customer);
  });
  await step(page,info,"Create supplier opening debt and clear it with a mixed-method payment",async()=>{
    await page.goto("/shop/suppliers");await page.getByLabel("Name",{exact:true}).fill(supplier);await page.getByLabel("Opening amount owed").fill("200");
    await page.getByRole("button",{name:"Add account",exact:true}).click();await page.getByRole("row").filter({hasText:supplier}).getByRole("button",{name:"Account / payment"}).click();
    await page.getByLabel("Cash (₹)",{exact:true}).fill("100");await page.getByLabel("UPI (₹)",{exact:true}).fill("100");await page.getByRole("button",{name:"Record supplier payment",exact:true}).click();
    await expect(page.getByRole("heading",{name:`${supplier} · ₹0.00 outstanding`})).toBeVisible();
  });
});

test("Counter workflow — supplier credit, billing, collections, returns and print action",async({page,request},info)=>{
  const tag=Date.now(),name=`QA Counter filter ${tag}`;const p=await seedPart(request,name);
  const supplier=await command(request,"party",{kind:"supplier",name:`Counter supplier ${tag}`});
  const customer=await command(request,"party",{kind:"customer",name:`Counter customer ${tag}`});let saleId=0,paidId=0;
  await step(page,info,"Receive five filters at 180 each, pay 400 now and leave 500 supplier credit",async()=>{
    await page.goto("/shop/purchases");await page.getByRole("combobox",{name:"Supplier",exact:true}).selectOption(String(supplier.partyId));
    await page.getByLabel("Supplier invoice / reference").fill(`QA-P-${tag}`);await chooseLine(page,p.id,name,"5","180");
    await page.getByLabel("Cash paid").fill("400");await page.getByRole("checkbox").first().check();await page.getByRole("button",{name:"Post purchase",exact:true}).click();
    await expect(page.getByRole("region",{name:"Document details"})).toContainText("Remaining: ₹500.00");expect((await stock(request,p.id)).quantity).toBe(25);
  });
  await step(page,info,"Pay the supplier's remaining 500 via UPI without changing stock",async()=>{
    await page.goto("/shop/suppliers");await page.getByRole("row").filter({hasText:`Counter supplier ${tag}`}).getByRole("button",{name:"Account / payment"}).click();
    await page.getByLabel("UPI (₹)",{exact:true}).fill("500");await page.getByRole("button",{name:"Record supplier payment",exact:true}).click();
    await expect(page.getByRole("heading",{name:`Counter supplier ${tag} · ₹0.00 outstanding`})).toBeVisible();expect((await stock(request,p.id)).quantity).toBe(25);
  });
  await step(page,info,"Bill two filters for 560; collect 200 now and leave customer credit",async()=>{
    await page.goto("/shop/sales");await page.getByRole("combobox",{name:"Customer",exact:true}).selectOption(String(customer.partyId));
    await page.getByLabel("Reference (optional)").fill(`QA-S-${tag}`);await chooseLine(page,p.id,name,"2","280");await page.getByLabel("Cash paid").fill("200");
    await page.getByRole("checkbox").first().check();await page.getByRole("button",{name:"Complete sale",exact:true}).click();
    await expect(page.getByRole("region",{name:"Document details"})).toContainText("Remaining: ₹360.00");
    saleId=(await shop(request)).documents.find(d=>d.reference===`QA-S-${tag}`)!.id;expect((await stock(request,p.id)).quantity).toBe(23);
    await page.evaluate(()=>{window.print=()=>{document.documentElement.dataset.qaPrint="called";};});await page.getByRole("button",{name:"Print A4",exact:true}).click();
    expect(await page.locator("html").getAttribute("data-qa-print")).toBe("called");
    await page.emulateMedia({media:"print"});await expect(page.getByRole("heading",{name:"Billing & sales",exact:true})).toBeHidden();await page.emulateMedia({media:"screen"});
  });
  await step(page,info,"Collect another 100; return a saleable filter, clear 260 debt and refund 20",async()=>{
    await page.goto("/shop/customers");await page.getByRole("row").filter({hasText:`Counter customer ${tag}`}).getByRole("button",{name:"Account / payment"}).click();
    await page.getByLabel("Cash (₹)",{exact:true}).fill("100");await page.getByRole("button",{name:"Record collection",exact:true}).click();
    await expect(page.getByRole("heading",{name:`Counter customer ${tag} · ₹260.00 outstanding`})).toBeVisible();
    await page.goto("/shop/returns");await page.getByRole("combobox",{name:"Original bill"}).selectOption(String(saleId));
    await page.getByLabel(`Return quantity for ${name}`).fill("1");await page.getByLabel("Reason",{exact:true}).fill("Wrong fitment QA");await page.getByLabel("Cash refund").fill("20");
    await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Record return",exact:true}).click();await expect(page.getByRole("status")).toContainText("Saved successfully");
    const state=await shop(request);expect(state.parties.find(a=>a.id===customer.partyId)?.balance).toBe(0);expect(state.returns.find(r=>r.documentId===saleId)).toMatchObject({total:28000,debtReduction:26000,refundCash:2000});
    expect((await stock(request,p.id)).quantity).toBe(24);
  });
  await step(page,info,"Fully paid walk-in sale, then damaged return with refund but no restocking",async()=>{
    await page.goto("/shop/sales");await page.getByLabel("Reference (optional)").fill(`QA-PAID-${tag}`);await chooseLine(page,p.id,name,"1","280");
    await page.getByRole("button",{name:"Full UPI",exact:true}).click();await page.getByRole("checkbox").first().check();await page.getByRole("button",{name:"Complete sale",exact:true}).click();
    await expect(page.getByRole("region",{name:"Document details"})).toContainText("Remaining: ₹0.00");paidId=(await shop(request)).documents.find(d=>d.reference===`QA-PAID-${tag}`)!.id;
    await page.goto("/shop/returns");await page.getByRole("combobox",{name:"Original bill"}).selectOption(String(paidId));await page.getByLabel(`Return quantity for ${name}`).fill("1");
    await page.getByRole("combobox",{name:`Condition for ${name}`}).selectOption("false");await page.getByLabel("Reason",{exact:true}).fill("Damaged part QA");await page.getByLabel("UPI refund").fill("280");
    await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Record return",exact:true}).click();await expect(page.getByRole("status")).toContainText("Saved successfully");
    expect((await stock(request,p.id)).quantity).toBe(23);await expect(page.getByText(`${name} × 1 · Damaged / not restocked`,{exact:true})).toBeVisible();
  });
});

test("Cancellation — reversal, history, repeated cancellation guard and default purchase cost",async({page,request},info)=>{
  const tag=Date.now(),name=`QA Cancel part ${tag}`;const p=await seedPart(request,name,{purchaseCostPaise:12000});
  const sale=await command(request,"document",{kind:"sale",lines:[{partId:p.id,quantity:1,unitPrice:28000}],cash:10000,upi:18000});
  await step(page,info,"Cancel a paid sale and reverse its stock and original payment",async()=>{
    await page.goto("/shop/sales");const d=(await shop(request)).documents.find(d=>d.id===sale.documentId)!;
    await page.getByRole("row").filter({hasText:d.number}).getByRole("button",{name:"View / print",exact:true}).click();
    const receipt=page.getByRole("region",{name:"Document details"});await receipt.getByLabel("Cancellation reason").fill("QA wrong bill");await receipt.getByRole("checkbox").check();await receipt.getByRole("button",{name:"Cancel document",exact:true}).click();
    await expect(receipt).toContainText("Status: cancelled");expect((await stock(request,p.id)).quantity).toBe(20);
    const state=await shop(request);expect(state.payments.find(m=>m.documentId===d.id&&m.kind==="sale_cancel")).toMatchObject({cash:10000,upi:18000,direction:"out"});
    const again=await request.post("/api/shop",{headers:{Origin:origin},data:{requestId:crypto.randomUUID(),action:"cancel",data:{documentId:d.id,reason:"Again QA"}}});expect(again.status()).toBe(400);
  });
  const supplier=await command(request,"party",{kind:"supplier",name:`Cancel supplier ${tag}`});
  const purchase=await command(request,"document",{kind:"purchase",partyId:supplier.partyId,lines:[{partId:p.id,quantity:2,unitPrice:18000}],cash:36000});
  await step(page,info,"Cancel a mistaken purchase; reverse stock/payment and restore the prior purchase-cost reference",async()=>{
    await page.goto("/shop/purchases");const d=(await shop(request)).documents.find(d=>d.id===purchase.documentId)!;
    await page.getByRole("row").filter({hasText:d.number}).getByRole("button",{name:"View / print",exact:true}).click();
    const receipt=page.getByRole("region",{name:"Document details"});await receipt.getByLabel("Cancellation reason").fill("QA wrong purchase price");await receipt.getByRole("checkbox").check();await receipt.getByRole("button",{name:"Cancel document",exact:true}).click();
    await expect(receipt).toContainText("Status: cancelled");const updated=await stock(request,p.id);expect(updated.quantity).toBe(20);expect(updated.purchaseCostPaise).toBe(12000);
  });
});

test("Reports and recovery — date filtering, export, invalid backup rejection and real restore",async({page,request},info)=>{
  const name=`QA Report part ${Date.now()}`;const p=await seedPart(request,name);
  await command(request,"document",{kind:"sale",businessDate:"2026-01-03",lines:[{partId:p.id,quantity:2,unitPrice:12345}],cash:24690});
  await step(page,info,"Historical report shows 246.90 sales but zero historical cash receipts",async()=>{
    await page.goto("/shop/reports");await page.getByLabel("From",{exact:true}).fill("2026-01-03");await page.getByLabel("To",{exact:true}).fill("2026-01-03");
    await expect(page.locator(".metric").filter({hasText:"Gross sales"})).toContainText("246.90");await expect(page.locator(".metric").filter({hasText:"Cash received"})).toContainText("0.00");
    const download=page.waitForEvent("download");await page.getByRole("button",{name:"Export records JSON"}).click();const file=await download;const path=info.outputPath("records.json");await file.saveAs(path);
    expect(JSON.parse(readFileSync(path,"utf8")).parts.some((part:{name:string})=>part.name===name)).toBe(true);
  });
  let backupPath="";let before=await shop(request);
  await step(page,info,"Create and download a consistent manual backup",async()=>{
    await page.goto("/shop/settings");await page.getByRole("button",{name:"Create backup now"}).click();await expect(page.getByRole("status")).toContainText("Backup created");
    const download=page.waitForEvent("download");await page.getByRole("link",{name:"Download",exact:true}).first().click();const file=await download;backupPath=info.outputPath("watched-backup.sqlite");await file.saveAs(backupPath);
    expect(readFileSync(backupPath).subarray(0,16).toString()).toBe("SQLite format 3\u0000");before=await shop(request);
  });
  await step(page,info,"Reject a damaged backup without changing documents or balances",async()=>{
    await page.getByLabel("Backup file",{exact:true}).setInputFiles({name:"invalid.sqlite",mimeType:"application/vnd.sqlite3",buffer:Buffer.from("not a database")});
    await page.getByLabel("Type RESTORE VK AUTOMOBILES").fill("RESTORE VK AUTOMOBILES");await page.getByRole("button",{name:"Validate & restore backup"}).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("valid SQLite backup");expect(await shop(request)).toEqual(before);
  });
  await step(page,info,"Restore the downloaded backup, remove later test records and keep a recovery copy",async()=>{
    const marker=`After backup ${Date.now()}`;await command(request,"party",{kind:"customer",name:marker,openingBalance:10000});
    await page.getByLabel("Backup file",{exact:true}).setInputFiles(backupPath);await page.getByRole("button",{name:"Validate & restore backup"}).click();
    await expect(page).toHaveURL(/\/login/);await signIn(request,origin);await signIn(page.request,origin);await page.goto("/shop/settings");expect(await shop(request)).toEqual(before);
    await expect(page.getByText(/before-restore-/).first()).toBeVisible();
  });
});

test("CSV export — preserve part names exactly while escaping spreadsheet formulas",async({page,request},info)=>{
  const name="=1+1";await seedPart(request,name);
  await step(page,info,"Export stock CSV without losing the first character of a formula-like part name",async()=>{
    await page.goto("/shop/reports");const downloaded=page.waitForEvent("download");await page.getByRole("button",{name:"Export stock CSV"}).click();
    const file=await downloaded,path=info.outputPath("stock.csv");await file.saveAs(path);const text=readFileSync(path,"utf8");expect(text).toContain('"\'=1+1"');
  });
});

test("Receipt settings — save details, persist them and keep branding consistent",async({page,request},info)=>{
  const name="VK Automobiles QA Branch (Spare parts)";
  await step(page,info,"Save shop name, address and phone for receipts",async()=>{
    await page.goto("/shop/settings");await page.getByLabel("Shop name",{exact:true}).fill(name);await page.getByLabel("Address",{exact:true}).fill("QA test address, Kerala");await page.getByLabel("Phone",{exact:true}).fill("0000000000");
    await page.getByRole("button",{name:"Save receipt details",exact:true}).click();await expect(page.getByRole("status")).toContainText("Saved successfully");
    expect((await shop(request)).settings).toEqual({shopName:name,address:"QA test address, Kerala",phone:"0000000000"});
  });
  await step(page,info,"Saved shop name appears on both the home and inventory screens",async()=>{
    await page.goto("/shop/home");await expect(page.locator(".brand")).toContainText(name);await page.goto("/");await expect(page.locator(".brand")).toContainText(name);
  });
});
