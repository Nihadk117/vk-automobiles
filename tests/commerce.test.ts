import Database from "better-sqlite3";
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { addPart,initialiseDatabase,listParts,editPart } from "../src/server/inventory";
import { command,snapshot } from "../src/server/commerce";
let db:Database.Database;
beforeEach(()=>{db=new Database(":memory:");initialiseDatabase(db);});afterEach(()=>db.close());
const execute=(action:string,data:unknown,requestId=randomUUID())=>command(db,{action,data,requestId});
function setup(){
  const part=addPart(db,{name:"Air filter",rack:"A-1",vehicle:"Swift, Baleno",openingQuantity:10,sellingPricePaise:28000});
  const customerId=execute("party",{kind:"customer",name:"Test customer",openingBalance:0}).partyId as number;
  const supplierId=execute("party",{kind:"supplier",name:"Test supplier",openingBalance:0}).partyId as number;
  return {part,customerId,supplierId};
}
const docInput=(partId:number,extra:Record<string,unknown>={})=>({kind:"sale",lines:[{partId,quantity:2,unitPrice:28000}],cash:56000,upi:0,...extra});
describe("sales and credit",()=>{
  it("posts a cash bill atomically and snapshots its price and description",()=>{
    const {part}=setup();const {documentId}=execute("document",docInput(part.id));
    expect(listParts(db)[0].quantity).toBe(8);
    const {id,quantity,...details}=listParts(db)[0];void quantity;
    editPart(db,id,{...details,name:"New name",sellingPricePaise:50000});
    const sale=snapshot(db).documents.find(d=>d.id===documentId)!;
    expect(sale).toMatchObject({total:56000,paid:56000,due:0,partyName:"Walk-in"});
    expect(sale.lines[0]).toMatchObject({description:"Air filter",unitPrice:28000});
    expect(snapshot(db).payments[0]).toMatchObject({cash:56000,direction:"in"});
  });
  it("records a partial UPI credit sale and later cash collection without changing stock",()=>{
    const {part,customerId}=setup();execute("document",docInput(part.id,{partyId:customerId,cash:0,upi:20000}));
    expect(snapshot(db).parties.find(p=>p.id===customerId)?.balance).toBe(36000);
    execute("payment",{partyId:customerId,cash:10000,upi:0});
    expect(snapshot(db).parties.find(p=>p.id===customerId)?.balance).toBe(26000);expect(listParts(db)[0].quantity).toBe(8);
  });
  it("allocates collections to opening balances and then the oldest bill",()=>{
    const {part}=setup();const {partyId}=execute("party",{kind:"customer",name:"Existing debt",openingBalance:10000});
    execute("document",docInput(part.id,{partyId,cash:0}));execute("payment",{partyId,cash:15000});
    const docs=snapshot(db).documents.filter(d=>d.partyId===partyId).sort((a,b)=>a.id-b.id);
    expect(docs.map(d=>d.due)).toEqual([0,51000]);
  });
  it("rejects overselling, unassigned credit, excess payment, duplicate lines and fractional quantities",()=>{
    const {part}=setup();for(const extra of [
      {lines:[{partId:part.id,quantity:11,unitPrice:28000}],cash:308000},
      {cash:0},{cash:56001},
      {lines:[{partId:part.id,quantity:1,unitPrice:28000},{partId:part.id,quantity:1,unitPrice:28000}]},
      {lines:[{partId:part.id,quantity:1.5,unitPrice:28000}]},
    ])expect(()=>execute("document",docInput(part.id,extra))).toThrow();
    expect(snapshot(db).documents).toHaveLength(0);expect(listParts(db)[0].quantity).toBe(10);
  });
  it("allocates by document date when an older invoice is entered later",()=>{
    const {part,customerId}=setup();
    const newer=execute("document",docInput(part.id,{partyId:customerId,cash:0,businessDate:"2026-01-02"}));
    const older=execute("document",docInput(part.id,{partyId:customerId,cash:0,businessDate:"2026-01-01"}));
    execute("payment",{partyId:customerId,cash:56000});
    expect(snapshot(db).documents.find(d=>d.id===older.documentId)?.due).toBe(0);
    expect(snapshot(db).documents.find(d=>d.id===newer.documentId)?.due).toBe(56000);
  });
  it("does not post twice on retry; changed details cannot reuse the request key",()=>{
    const {part}=setup(),key=randomUUID(),payload=docInput(part.id);
    expect(execute("document",payload,key)).toEqual(execute("document",payload,key));
    expect(snapshot(db).documents).toHaveLength(1);expect(listParts(db)[0].quantity).toBe(8);
    expect(()=>execute("document",{...payload,cash:0},key)).toThrow("different details");
  });
  it("rolls back the bill and payment when a stock write fails",()=>{
    const {part}=setup();db.exec("CREATE TRIGGER fail_sale BEFORE INSERT ON stock_movements WHEN NEW.reason='sale' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
    expect(()=>execute("document",docInput(part.id))).toThrow("injected failure");
    expect(snapshot(db).documents).toHaveLength(0);expect(snapshot(db).payments).toHaveLength(0);expect(listParts(db)[0].quantity).toBe(10);
  });
});
describe("purchases and returns",()=>{
  it("receives five parts, tracks supplier credit and later payment without changing stock",()=>{
    const {part,supplierId}=setup();execute("document",{kind:"purchase",partyId:supplierId,lines:[{partId:part.id,quantity:5,unitPrice:18000}],cash:40000});
    expect(listParts(db)[0]).toMatchObject({quantity:15,purchaseCostPaise:18000});
    expect(snapshot(db).parties.find(p=>p.id===supplierId)?.balance).toBe(50000);
    execute("payment",{partyId:supplierId,upi:50000});expect(snapshot(db).parties.find(p=>p.id===supplierId)?.balance).toBe(0);expect(listParts(db)[0].quantity).toBe(15);
    expect(()=>execute("payment",{partyId:supplierId,cash:1})).toThrow("exceeds");
  });
  it("reduces original-bill debt first and refunds only the excess; rejects repeat returns",()=>{
    const {part,customerId}=setup();const {documentId}=execute("document",docInput(part.id,{partyId:customerId,cash:20000}));
    execute("payment",{partyId:customerId,upi:10000});const sale=snapshot(db).documents[0],lineId=sale.lines[0].id;
    const payload={documentId,reason:"Wrong fitment",refundCash:2000,lines:[{lineId,quantity:1,saleable:true}]};
    const key=randomUUID();execute("return",payload,key);execute("return",payload,key);
    expect(snapshot(db).documents[0].due).toBe(0);expect(listParts(db)[0].quantity).toBe(9);
    expect(snapshot(db).returns[0]).toMatchObject({total:28000,debtReduction:26000,refundCash:2000});
    expect(()=>execute("return",{...payload,refundCash:56000,lines:[{lineId,quantity:2,saleable:true}]})).toThrow("remaining quantity");
  });
  it("does not put damaged returns into saleable stock; refund must be exact",()=>{
    const {part}=setup();const {documentId}=execute("document",docInput(part.id));const lineId=snapshot(db).documents[0].lines[0].id;
    const payload={documentId,reason:"Damaged item",refundUpi:28000,lines:[{lineId,quantity:1,saleable:false}]};
    expect(()=>execute("return",{...payload,refundUpi:27000})).toThrow("Refund must");execute("return",payload);
    expect(listParts(db)[0].quantity).toBe(8);expect(snapshot(db).payments[0]).toMatchObject({kind:"refund",upi:28000,direction:"out"});
  });
  it("supports a free-item return with zero refund",()=>{
    const {part}=setup();const {documentId}=execute("document",docInput(part.id,{cash:0,lines:[{partId:part.id,quantity:1,unitPrice:0}]}));
    execute("return",{documentId,reason:"Free item return",lines:[{lineId:snapshot(db).documents[0].lines[0].id,quantity:1,saleable:true}]});
    expect(listParts(db)[0].quantity).toBe(10);
  });
});
describe("reversals, migrations and isolation",()=>{
  it("cancels a bill with opposite stock and cash/UPI movements, retains history",()=>{
    const {part}=setup();const {documentId}=execute("document",docInput(part.id,{cash:20000,upi:36000}));
    execute("cancel",{documentId,reason:"Entered wrong bill"});
    expect(listParts(db)[0].quantity).toBe(10);expect(snapshot(db).documents[0]).toMatchObject({status:"cancelled",due:0,total:56000});
    expect(snapshot(db).payments[0]).toMatchObject({kind:"sale_cancel",cash:20000,upi:36000,direction:"out"});
    expect(()=>execute("cancel",{documentId,reason:"Again"})).toThrow("Only active");
  });
  it("blocks cancellation after a collection or return",()=>{
    const {part,customerId}=setup();const {documentId}=execute("document",docInput(part.id,{partyId:customerId,cash:0}));
    execute("payment",{partyId:customerId,cash:100});expect(()=>execute("cancel",{documentId,reason:"Correction"})).toThrow("Later payments");
  });
  it("blocks purchase cancellation when stock has already been used",()=>{
    const part=addPart(db,{name:"New part",rack:"B",openingQuantity:0,sellingPricePaise:100});const {partyId}=execute("party",{kind:"supplier",name:"Supplier"});
    const purchase=execute("document",{kind:"purchase",partyId,lines:[{partId:part.id,quantity:2,unitPrice:50}]});
    execute("document",{kind:"sale",lines:[{partId:part.id,quantity:1,unitPrice:100}],cash:100});
    expect(()=>execute("cancel",{documentId:purchase.documentId,reason:"Wrong purchase"})).toThrow("no longer fully available");
  });
  it("persists structured vehicle links and settings",()=>{
    setup();expect(db.prepare("SELECT COUNT(*) AS n FROM part_vehicles").get()).toEqual({n:2});
    execute("settings",{shopName:"VK Automobiles (Spare parts)",address:"Test address",phone:"Test phone"});
    expect(snapshot(db).settings.address).toBe("Test address");
  });
  it("updates contact details without rewriting historical bill names",()=>{
    const {part,customerId}=setup();execute("document",docInput(part.id,{partyId:customerId}));
    execute("party_edit",{partyId:customerId,name:"Corrected customer",phone:"12345"});
    expect(snapshot(db).parties.find(p=>p.id===customerId)).toMatchObject({name:"Corrected customer",phone:"12345"});
    expect(snapshot(db).documents[0].partyName).toBe("Test customer");
  });
});
