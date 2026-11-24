import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {signIn,testPassword} from "../auth-fixtures";
const origin="http://127.0.0.1:3120",headers={Origin:origin};
test.describe.configure({mode:"serial"});
let recoveryCode:string;
test("signed-out requests are blocked and first-run owner setup has no default credentials",async({page,request,browser},info)=>{
  for(const url of ["/api/shop","/api/parts","/api/parts/1","/api/backups","/api/backups?download=anything.sqlite","/api/users"]){const r=await request.get(url);expect(r.status(),url).toBe(401);}
  for(const url of ["/api/shop","/api/parts","/api/backups","/api/restore","/api/users"]){const r=await request.post(url,{headers,data:{}});expect(r.status(),url).toBe(401);}
  expect((await request.patch("/api/parts/1",{headers,data:{}})).status()).toBe(401);
  expect((await request.post("/api/parts/1/adjustments",{headers,data:{}})).status()).toBe(401);
  await page.goto("/shop/sales");await expect(page).toHaveURL(/\/login/);await expect(page.getByRole("heading",{name:"Create the owner account"})).toBeVisible();
  const cold=await browser.newContext({javaScriptEnabled:false});try{const coldPage=await cold.newPage();await coldPage.goto(`${origin}/login`);await expect(coldPage.getByLabel("Password",{exact:true})).toBeDisabled();await expect(coldPage.locator("form")).toHaveAttribute("method","post");}finally{await cold.close();}
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("owner-setup-mobile.png"),fullPage:true});
  await page.getByLabel("Username",{exact:true}).fill("test-owner");await page.getByLabel("Password",{exact:true}).fill(testPassword);await page.getByLabel("Confirm password",{exact:true}).fill(testPassword);await page.getByRole("button",{name:"Create owner account",exact:true}).click();
  const code=page.getByLabel("Recovery code",{exact:true});await expect(code).toBeVisible();recoveryCode=await code.inputValue();expect(recoveryCode).toMatch(/^[a-f0-9]{48}$/);
  await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Continue",exact:true}).click();await expect(page.getByRole("heading",{name:"Shop overview"})).toBeVisible();
  expect((await request.post("/api/auth",{headers,data:{action:"setup",data:{username:"another",password:testPassword}}})).status()).toBe(409);
  const cookies=await page.context().cookies();expect(cookies.find(c=>c.name==="vk_session_3120")).toMatchObject({httpOnly:true,sameSite:"Strict"});
  await page.getByRole("button",{name:"Lock / sign out"}).click();await expect(page).toHaveURL(/\/login/);await page.goto("/");await expect(page).toHaveURL(/\/login/);
});
test("staff restrictions apply to screens and direct API writes, while normal billing works",async({page,request,playwright},info)=>{
  await signIn(request,origin);await signIn(page.request,origin);await page.goto("/account");
  await page.getByLabel("Staff username",{exact:true}).fill("counter-staff");await page.getByLabel("Initial staff password").fill(testPassword);await page.getByRole("button",{name:"Create staff account",exact:true}).click();await expect(page.getByRole("status")).toContainText("Staff account created");
  const partResponse=await request.post("/api/parts",{headers,data:{name:"Auth Air Filter",rack:"AUTH-01",openingQuantity:20,sellingPricePaise:28000}});expect(partResponse.status()).toBe(201);const {part}=await partResponse.json();
  const staff=await playwright.request.newContext({baseURL:origin});try{
    const r=await staff.post("/api/auth",{headers,data:{action:"login",data:{username:"counter-staff",password:testPassword}}});expect(r.ok()).toBe(true);
    for(const url of ["/api/users","/api/backups"]){expect((await staff.get(url)).status()).toBe(403);}
    for(const url of ["/api/parts","/api/parts/1/adjustments","/api/restore","/api/backups","/api/users"]){expect((await staff.post(url,{headers,data:{}})).status(),url).toBe(403);}
    expect((await staff.patch(`/api/parts/${part.id}`,{headers,data:{}})).status()).toBe(403);
    for(const action of ["settings","return","cancel","party_edit"]){expect((await staff.post("/api/shop",{headers,data:{requestId:randomUUID(),action,data:{}}})).status(),action).toBe(403);}
    const data={kind:"sale",lines:[{partId:part.id,quantity:1,unitPrice:100}],cash:100};
    expect((await staff.post("/api/shop",{headers,data:{requestId:randomUUID(),action:"document",data}})).status()).toBe(403);
    data.lines[0].unitPrice=28000;data.cash=28000;const posted=await staff.post("/api/shop",{headers,data:{requestId:randomUUID(),action:"document",data}});expect(posted.status()).toBe(200);
    expect((await staff.post("/api/auth",{headers:{Origin:"https://untrusted.example"},data:{action:"logout"}})).status()).toBe(403);
    await page.getByRole("button",{name:"Lock / sign out"}).click();await page.getByLabel("Username",{exact:true}).fill("counter-staff");await page.getByLabel("Password",{exact:true}).fill(testPassword);await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL(/\/shop\/home/);expect(page.url()).not.toContain("password");
    await expect(page.getByRole("navigation").getByRole("link",{name:"Settings & backup"})).toHaveCount(0);
    await page.goto("/");await expect(page.getByRole("status")).toContainText("Local database connected");await expect(page.getByRole("button",{name:"Add a part"})).toHaveCount(0);await expect(page.getByRole("button",{name:"Edit",exact:true})).toHaveCount(0);
    await page.goto("/shop/sales");await page.getByLabel("Find a part",{exact:true}).fill("Auth Air Filter");await page.locator(".part-match").first().click();await expect(page.getByLabel("Price for Auth Air Filter")).toHaveAttribute("readonly","");
    await page.screenshot({path:info.outputPath("staff-billing.png"),fullPage:true});
    await page.goto("/shop/settings");await expect(page).toHaveURL(/\/shop\/home/);
    const ownerEvents=await(await request.get("/api/users")).json();expect(ownerEvents.audit.some((a:{actor:string;action:string})=>a.actor==="counter-staff"&&a.action==="shop.document")).toBe(true);expect(JSON.stringify(ownerEvents)).not.toContain(testPassword);
  }finally{await staff.dispose();}
});
test("staff password changes revoke sessions and the owner can reset a staff password",async({page,request})=>{
  await signIn(request,origin);
  expect((await page.request.post("/api/auth",{headers,data:{action:"login",data:{username:"counter-staff",password:testPassword}}})).ok()).toBe(true);
  await page.goto("/account");await page.getByLabel("Current password",{exact:true}).fill(testPassword);await page.getByLabel("New password",{exact:true}).fill("Staff-changed-password-123");await page.getByLabel("Confirm new password",{exact:true}).fill("Staff-changed-password-123");await page.getByRole("button",{name:"Change password & sign out"}).click();await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get("/api/shop")).status()).toBe(401);
  await signIn(page.request,origin);await page.goto("/account");
  const access=await(await request.get("/api/users")).json(),staff=access.users.find((u:{username:string})=>u.username==="counter-staff");
  await page.getByLabel("Staff account",{exact:true}).selectOption(String(staff.id));await page.getByLabel("Replacement password").fill(testPassword);await page.getByRole("button",{name:"Reset staff password",exact:true}).click();await expect(page.getByRole("status")).toContainText("Staff password reset");
});
test("disabling staff revokes existing sessions and cannot disable the owner",async({request,playwright})=>{
  await signIn(request,origin);const access=await(await request.get("/api/users")).json(),staffUser=access.users.find((u:{username:string})=>u.username==="counter-staff"),owner=access.users.find((u:{role:string})=>u.role==="owner");
  const staff=await playwright.request.newContext({baseURL:origin});try{
    expect((await staff.post("/api/auth",{headers,data:{action:"login",data:{username:"counter-staff",password:testPassword}}})).ok()).toBe(true);
    expect((await request.post("/api/users",{headers,data:{id:staffUser.id,enabled:false}})).ok()).toBe(true);expect((await staff.get("/api/parts")).status()).toBe(401);
    expect((await staff.post("/api/auth",{headers,data:{action:"login",data:{username:"counter-staff",password:testPassword}}})).status()).toBe(401);
    expect((await request.post("/api/users",{headers,data:{id:owner.id,enabled:false}})).status()).toBe(400);
  }finally{await staff.dispose();}
});
test("inactive browser locks after fifteen minutes and revokes its session",async({page})=>{
  await signIn(page.request,origin);await page.clock.install();await page.goto("/shop/home");await expect(page.getByRole("heading",{name:"Shop overview"})).toBeVisible();
  await page.clock.fastForward(16*60000);await expect(page).toHaveURL(/\/login/);expect((await page.request.get("/api/shop")).status()).toBe(401);
});
test("owner recovery rotates the code, signs out existing sessions and accepts the new password",async({page,request})=>{
  await signIn(request,origin);await page.goto("/login");await page.getByRole("button",{name:"Forgot owner password?"}).click();await page.getByLabel("Recovery code",{exact:true}).fill(recoveryCode);await page.getByLabel("New password",{exact:true}).fill("Recovered-owner-password-123");await page.getByLabel("Confirm password",{exact:true}).fill("Recovered-owner-password-123");await page.getByRole("button",{name:"Reset owner password",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Keep your recovery code safe"})).toBeVisible();
  const replacement=page.getByLabel("Recovery code",{exact:true});await expect(replacement).not.toHaveValue(recoveryCode);
  expect((await request.get("/api/shop")).status()).toBe(401);expect((await request.post("/api/auth",{headers,data:{action:"recover",data:{recoveryCode,password:testPassword}}})).status()).toBe(401);
  await page.getByRole("checkbox").check();await page.getByRole("button",{name:"Continue",exact:true}).click();await page.getByLabel("Username",{exact:true}).fill("test-owner");await page.getByLabel("Password",{exact:true}).fill("Recovered-owner-password-123");await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page.getByRole("heading",{name:"Shop overview"})).toBeVisible();
});
