import Database from "better-sqlite3";
import { beforeEach,afterEach,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { initialiseDatabase,addPart,listParts,editPart } from "../src/server/inventory";
import { command,snapshot } from "../src/server/commerce";
import { csvCell } from "../src/shared/shop";
let db:Database.Database;
beforeEach(()=>{db=new Database(":memory:");initialiseDatabase(db);});afterEach(()=>db.close());
const run=(action:string,data:unknown)=>command(db,{requestId:randomUUID(),action,data});
function setup(cost:number|null=12000){
  const p=addPart(db,{name:"Cost reference filter",rack:"QA",openingQuantity:10,sellingPricePaise:28000,purchaseCostPaise:cost});
  const supplier=run("party",{kind:"supplier",name:"Supplier"});
  return {part:p,supplierId:supplier.partyId};
}
function purchase(partId:number,partyId:unknown,cost:number){return run("document",{kind:"purchase",partyId,lines:[{partId,quantity:2,unitPrice:cost}],cash:cost*2});}
it("restores the actual previous default cost when cancelling a purchase",()=>{
  const {part,supplierId}=setup(),posted=purchase(part.id,supplierId,18000);
  expect(listParts(db)[0].purchaseCostPaise).toBe(18000);run("cancel",{documentId:posted.documentId,reason:"Wrong invoice"});
  expect(listParts(db)[0]).toMatchObject({quantity:10,purchaseCostPaise:12000});
});
it("restores unknown cost as null and known zero as zero",()=>{
  for(const cost of [null,0]){
    const {part,supplierId}=setup(cost),posted=purchase(part.id,supplierId,18000);run("cancel",{documentId:posted.documentId,reason:"Wrong invoice"});
    expect(listParts(db).find(p=>p.id===part.id)?.purchaseCostPaise).toBe(cost);
  }
});
it("reconciles out-of-order purchase cancellations without reviving another cancelled cost",()=>{
  const {part,supplierId}=setup(),first=purchase(part.id,supplierId,18000),second=purchase(part.id,supplierId,20000);
  run("cancel",{documentId:first.documentId,reason:"Wrong older purchase"});expect(listParts(db)[0].purchaseCostPaise).toBe(20000);
  run("cancel",{documentId:second.documentId,reason:"Wrong newer purchase"});expect(listParts(db)[0].purchaseCostPaise).toBe(12000);
});
it("preserves an explicit manual cost correction made after a purchase",()=>{
  const {part,supplierId}=setup(),posted=purchase(part.id,supplierId,18000);
  const {id,quantity,...details}=listParts(db)[0];void quantity;editPart(db,id,{...details,purchaseCostPaise:25000});
  run("cancel",{documentId:posted.documentId,reason:"Wrong invoice"});expect(listParts(db)[0].purchaseCostPaise).toBe(25000);
});
it("rolls back the purchase and stock if cost audit recording fails",()=>{
  const {part,supplierId}=setup();db.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON part_changes BEGIN SELECT RAISE(ABORT,'cost audit failure'); END;");
  expect(()=>purchase(part.id,supplierId,18000)).toThrow("cost audit failure");expect(snapshot(db).documents).toHaveLength(0);
  expect(listParts(db)[0]).toMatchObject({quantity:10,purchaseCostPaise:12000});
});
it.each(["=1+1","+part","-bracket","@brand","\t=1+1"])("escapes CSV formulas without deleting original characters: %s",value=>{
  expect(csvCell(value)).toBe('"\''+value+'"');
});
it("escapes CSV quotation marks and preserves ordinary names",()=>{expect(csvCell('Filter, 12"')).toBe('"Filter, 12"""');});
