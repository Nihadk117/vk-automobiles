import { expect,it } from "vitest";
import { searchParts } from "../src/shared/part-search";
import type { Part } from "../src/server/inventory";
const base={revision:1,lowStockLevel:0,purchaseCostPaise:null,quantity:10,sellingPricePaise:100};
const parts:Part[]=[{...base,id:1,name:"Air Filter",brand:"Bosch",vehicle:"Swift, Baleno",partNumber:"AF-100",rack:"A-02"},
  {...base,id:2,name:"Air Filter",brand:"Mann",vehicle:"Hyundai i20",partNumber:"AF-200",rack:"B-01"},
  {...base,id:3,name:"Oil Filter",brand:"Bosch",vehicle:"Swift",partNumber:"OF-300",rack:"C-03"}];
it.each([["Bosch",[1,3]],["  bOsCh   AIR  ",[1]],["Swift filter",[1,3]],["Baleno",[1]],["AF100",[1]],["B01",[2]],["SP0003",[3]],["airfilter",[1,2]],["not-a-part",[]],["   ",[1,2,3]]])("matches %s across the catalogue",(query,ids)=>{
  expect(searchParts(parts,query as string).map(p=>p.id)).toEqual(ids);
});
