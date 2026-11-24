import {test,expect} from "../auth-fixtures";
import {mkdirSync,renameSync,writeFileSync,unlinkSync,existsSync} from "node:fs";
import {resolve,dirname,join,sep} from "node:path";

test("invalid staff usernames fail browser validation before submission",async({page})=>{
  await page.goto("/account");const name=page.getByLabel("Staff username",{exact:true});
  await name.fill("invalid username");await expect.poll(()=>name.evaluate((el:HTMLInputElement)=>el.validity.patternMismatch)).toBe(true);
  await name.fill("counter-staff_2");expect(await name.evaluate((el:HTMLInputElement)=>el.checkValidity())).toBe(true);
});
test("sign out still clears the visible workspace if browser storage is unavailable",async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(Storage.prototype,"setItem",{value(){throw new DOMException("Storage blocked","SecurityError");}});});
  await page.goto("/shop/home");await expect(page.getByRole("heading",{name:"Shop overview"})).toBeVisible();
  await page.getByRole("button",{name:"Lock / sign out"}).click();await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get("/api/shop")).status()).toBe(401);
});
test("idle locking waits for logout and never reopens the workspace during a slow response",async({page})=>{
  await page.clock.install();await page.goto("/shop/home");await expect(page.getByRole("heading",{name:"Shop overview"})).toBeVisible();
  await page.clock.pauseAt(new Date(Date.now()+1000));
  let releaseLogout=()=>{};const gate=new Promise<void>(resolve=>{releaseLogout=resolve;});
  await page.route("**/api/auth",async route=>{
    if(route.request().method()==="POST"&&route.request().postDataJSON()?.action==="logout")await gate;
    await route.continue();
  });
  await page.clock.fastForward(16*60000);
  try{
    await expect(page.getByRole("dialog",{name:"Locking workspace"})).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveAttribute("inert","");
    await expect(page.getByRole("dialog",{name:"Locking workspace"})).toBeFocused();
  }finally{releaseLogout();}
  await expect(page).toHaveURL(/\/login/);expect((await page.request.get("/api/shop")).status()).toBe(401);
});
test("backup-folder failure is visible without preventing billing or changing records",async({page,request})=>{
  const file=resolve(process.env.SHOP_TEST_DATABASE||"data/browser-tests.sqlite"),testRoot=resolve("data/test-runs")+sep;
  test.skip(!file.startsWith(testRoot),"Filesystem fault injection is restricted to isolated test-runs databases.");
  const name=`Backup fault filter ${Date.now()}`;
  const added=await request.post("/api/parts",{headers:{Origin:"http://127.0.0.1:3100"},data:{name,rack:"STABILITY",openingQuantity:4,sellingPricePaise:28000}});expect(added.status()).toBe(201);
  const before=await(await request.get("/api/shop")).json();
  const backups=join(dirname(file),"backups"),hold=backups+"-stability-held";
  if(!existsSync(backups))mkdirSync(backups,{recursive:true});renameSync(backups,hold);
  try{
    writeFileSync(backups,"Simulated unavailable backup directory");
    const metadata=await request.get("/api/backups");expect(metadata.status()).toBe(200);expect((await metadata.json()).error).toBeTruthy();
    await page.goto("/shop/sales");await expect(page.getByRole("main")).toHaveAttribute("aria-busy","false");
    await page.getByLabel("Find a part",{exact:true}).fill(name);await expect(page.locator(".part-match")).toHaveCount(1);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Backup");
    expect(await(await request.get("/api/shop")).json()).toEqual(before);
  }finally{unlinkSync(backups);renameSync(hold,backups);}
});
