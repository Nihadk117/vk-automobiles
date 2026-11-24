import { test,expect } from "../auth-fixtures";
import type { Part } from "../../src/server/inventory";
const base={revision:1,lowStockLevel:0,purchaseCostPaise:17500};
const parts:Part[]=[
  {...base,id:91001,name:"Air Filter",brand:"Bosch",vehicle:"Maruti Suzuki Swift, Baleno",partNumber:"AF-100",rack:"A-02",quantity:10,sellingPricePaise:28000},
  {...base,id:91002,name:"Air Filter",brand:"Mann",vehicle:"Hyundai i20",partNumber:"AF-200",rack:"B-01",quantity:5,sellingPricePaise:31050},
  {...base,id:91003,name:"Oil Filter",brand:"Bosch",vehicle:"Swift",partNumber:"OF-300",rack:"C-03",quantity:3,sellingPricePaise:15000},
];
test.beforeEach(async({page})=>{
  // Read-only browser fixtures: no original or test-shop business records are written.
  await page.route("**/api/parts",route=>route.fulfill({json:{parts}}));
  await page.route("**/api/shop",route=>route.request().method()==="GET"?route.fulfill({json:{parties:[],documents:[],payments:[],returns:[],settings:{shopName:"VK Search Test",address:"",phone:""}}}):route.abort());
  await page.route("**/api/backups",route=>route.fulfill({json:{backups:[],error:""}}));
});
test("changing search clears a previously selected part",async({page})=>{
  await page.goto("/shop/sales");await page.getByRole("combobox",{name:"Part",exact:true}).selectOption("91001");
  await expect(page.getByRole("button",{name:"Add line",exact:true})).toBeEnabled();
  await page.getByLabel("Find a part",{exact:true}).fill("no-such-part");
  await expect(page.getByRole("button",{name:"Add line",exact:true})).toBeDisabled({timeout:3000});
  await expect(page.getByText("No parts match your search.",{exact:true})).toBeVisible();
});
test("shows live results for brand, vehicle, number, rack and normalized multi-word queries",async({page})=>{
  await page.goto("/shop/sales");const input=page.getByLabel("Find a part",{exact:true}),results=page.getByRole("region",{name:"Matching parts"});
  await input.fill("Bosch");await expect(results.getByRole("button")).toHaveCount(2);
  await input.fill("  bOsCh   AIR  ");await expect(results.getByRole("button")).toHaveCount(1);await expect(results).toContainText("AF-100");
  for(const [query,number] of [["Baleno","AF-100"],["AF100","AF-100"],["B-01","AF-200"],["SP91003","OF-300"]]){
    await input.fill(query);await expect(results.getByRole("button")).toHaveCount(1);await expect(results).toContainText(number);
  }
});
test("clicking a live result adds the right part and price, then clears the search",async({page},info)=>{
  await page.goto("/shop/sales");await page.getByLabel("Find a part",{exact:true}).fill("bosch air");
  await expect(page.getByRole("region",{name:"Matching parts"})).toContainText("10 available");
  await page.screenshot({path:info.outputPath("live-matches.png"),fullPage:true});
  await page.getByRole("region",{name:"Matching parts"}).getByRole("button").click();
  await expect(page.getByLabel("Quantity for Air Filter",{exact:true})).toHaveValue("1");await expect(page.getByLabel("Price for Air Filter",{exact:true})).toHaveValue("280.00");
  await expect(page.getByLabel("Find a part",{exact:true})).toHaveValue("");await expect(page.getByRole("button",{name:"Add line",exact:true})).toBeDisabled();
});
test("Enter adds only a unique match and never submits a sale",async({page})=>{
  const posts:string[]=[];page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
  await page.goto("/shop/sales");const input=page.getByLabel("Find a part",{exact:true});
  await input.fill("filter");await input.press("Enter");await expect(page.getByLabel("Quantity for Air Filter",{exact:true})).toHaveCount(0);
  await input.fill("OF-300");await input.press("Enter");await expect(page.getByLabel("Quantity for Oil Filter",{exact:true})).toHaveValue("1");
  expect(posts).toEqual([]);
});
test("purchases use the same search and work on a narrow screen",async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto("/shop/purchases");
  await page.getByLabel("Find a part",{exact:true}).fill("Bosch Air");await page.getByRole("region",{name:"Matching parts"}).getByRole("button").click();
  await expect(page.getByLabel("Price for Air Filter",{exact:true})).toHaveValue("175.00");
  expect((await page.getByLabel("Price for Air Filter",{exact:true}).boundingBox())!.width).toBeGreaterThan(80);
  await page.getByLabel("Find a part",{exact:true}).fill("nothing-matches");await page.getByRole("button",{name:"Clear search",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"Part",exact:true}).getByRole("option")).toHaveCount(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("search-mobile.png"),fullPage:true});
});
