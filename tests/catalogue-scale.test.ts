import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { addPart,initialiseDatabase,listParts } from "../src/server/inventory";
import { command,snapshot } from "../src/server/commerce";
it("reconciles a 1,000-part catalogue after 50 ten-line bills",()=>{
  const db=new Database(":memory:");const started=performance.now();
  try{
    initialiseDatabase(db);
    const ids:number[]=[];
    db.transaction(()=>{for(let i=0;i<1000;i++)ids.push(addPart(db,{name:`Filter ${String(i).padStart(4,"0")}`,rack:`R-${i%20}`,vehicle:"QA Vehicle",openingQuantity:2,sellingPricePaise:123}).id);})();
    const loaded=performance.now();expect(listParts(db)).toHaveLength(1000);
    for(let bill=0;bill<50;bill++)command(db,{requestId:randomUUID(),action:"document",data:{kind:"sale",cash:1230,lines:ids.slice(bill*10,bill*10+10).map(partId=>({partId,quantity:1,unitPrice:123}))}});
    const state=snapshot(db),parts=listParts(db);
    expect(state.documents).toHaveLength(50);expect(state.payments).toHaveLength(50);expect(state.documents.every(d=>d.due===0)).toBe(true);
    expect(parts.reduce((n,p)=>n+p.quantity,0)).toBe(1500);expect(state.documents.reduce((n,d)=>n+d.total,0)).toBe(61500);
    console.log(JSON.stringify({scenario:"1000 parts and 50 ten-line bills",catalogueSetupMs:Math.round(loaded-started),postingAndReconciliationMs:Math.round(performance.now()-loaded),storage:"isolated in-memory SQLite; not a shop-machine performance guarantee"}));
  }finally{db.close();}
});
