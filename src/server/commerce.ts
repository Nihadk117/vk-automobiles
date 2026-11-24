import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { z } from "zod";
import { InventoryError,listParts } from "./inventory";
import type { Part } from "./inventory";
import type { Document,Line,Party,Payment,ReturnRecord,ShopSettings,Snapshot } from "../shared/shop";
import { dayInIndia } from "../shared/shop";

const amount=z.number().int().min(0).max(1_000_000_000),id=z.number().int().positive();
const settlement={cash:amount.default(0),upi:amount.default(0)};
const fail=(message:string,status=400):never=>{throw new InventoryError(message,status);};
export function documents(db:Database.Database):Document[]{
  const rows=db.prepare(`SELECT d.id,d.kind,d.party_id AS partyId,d.party_name AS partyName,d.reference,d.total,d.status,
    d.cancellation_reason AS cancellationReason,d.cancelled_at AS cancelledAt,
    CASE WHEN d.business_date='' THEN substr(datetime(d.created_at,'+330 minutes'),1,10) ELSE d.business_date END AS businessDate,d.created_at AS createdAt,
    COALESCE((SELECT SUM(amount) FROM allocations WHERE document_id=d.id),0) AS paid,
    COALESCE((SELECT SUM(debt_reduction) FROM customer_returns WHERE document_id=d.id),0) AS debtReduction
    FROM documents d ORDER BY d.id DESC`).all() as (Document&{debtReduction:number})[];
  const lines=db.prepare(`SELECT l.id,l.document_id AS documentId,l.part_id AS partId,l.description,l.part_number AS partNumber,
    l.quantity,l.unit_price AS unitPrice,COALESCE((SELECT SUM(quantity) FROM return_lines WHERE line_id=l.id),0) AS returned
    FROM document_lines l ORDER BY l.id`).all() as (Line&{documentId:number})[];
  return rows.map(d=>({...d,number:`VK-${d.kind==="sale"?"S":d.kind==="purchase"?"P":"O"}-${String(d.id).padStart(6,"0")}`,
    due:d.status==="cancelled"?0:d.total-d.paid-d.debtReduction,lines:lines.filter(l=>l.documentId===d.id)}));
}
export function snapshot(db:Database.Database):Snapshot{
  const docs=documents(db);
  const parties=db.prepare("SELECT id,kind,name,phone FROM parties ORDER BY name COLLATE NOCASE,id").all() as Party[];
  const settings=Object.fromEntries((db.prepare("SELECT key,value FROM settings").all() as {key:string;value:string}[]).map(r=>[r.key,r.value])) as ShopSettings;
  const allocations=db.prepare("SELECT payment_id AS paymentId,document_id AS documentId,amount FROM allocations ORDER BY id").all() as {paymentId:number;documentId:number;amount:number}[];
  const returnLines=db.prepare("SELECT r.return_id AS returnId,r.line_id AS lineId,l.description,r.quantity,r.saleable FROM return_lines r JOIN document_lines l ON l.id=r.line_id ORDER BY r.id").all() as {returnId:number;lineId:number;description:string;quantity:number;saleable:number}[];
  return {documents:docs,parties:parties.map(p=>({...p,balance:docs.filter(d=>d.partyId===p.id).reduce((n,d)=>n+d.due,0)})),settings,
    payments:(db.prepare(`SELECT id,party_id AS partyId,document_id AS documentId,kind,direction,cash,upi,note,created_at AS createdAt FROM payments ORDER BY id DESC`).all() as Payment[]).map(p=>({...p,allocations:allocations.filter(a=>a.paymentId===p.id).map(a=>({documentId:a.documentId,amount:a.amount}))})),
    returns:(db.prepare(`SELECT id,document_id AS documentId,total,debt_reduction AS debtReduction,refund_cash AS refundCash,refund_upi AS refundUpi,reason,created_at AS createdAt FROM customer_returns ORDER BY id DESC`).all() as ReturnRecord[]).map(r=>({...r,lines:returnLines.filter(l=>l.returnId===r.id).map(l=>({lineId:l.lineId,description:l.description,quantity:l.quantity,saleable:!!l.saleable}))}))};
}
function getDocument(db:Database.Database,documentId:number){return documents(db).find(d=>d.id===documentId)||fail("Document not found.",404);}
function party(db:Database.Database,partyId:number,kind:string){
  const result=db.prepare("SELECT id,kind,name FROM parties WHERE id=?").get(partyId) as Party|undefined;
  if(!result||result.kind!==kind)fail(`Choose a valid ${kind}.`);return result!;
}
function move(db:Database.Database,partId:number,quantity:number,reason:string,note:string){
  db.prepare("INSERT INTO stock_movements(part_id,quantity,reason,note) VALUES(?,?,?,?)").run(partId,quantity,reason,note);
  db.prepare("UPDATE parts SET revision=revision+1 WHERE id=?").run(partId);
}
function payment(db:Database.Database,partyId:number|null,documentId:number|null,kind:string,direction:string,cash:number,upi:number,note:string){
  return Number(db.prepare("INSERT INTO payments(party_id,document_id,kind,direction,cash,upi,note) VALUES(?,?,?,?,?,?,?)")
    .run(partyId,documentId,kind,direction,cash,upi,note).lastInsertRowid);
}
type CostSnapshot=Part&{costEvent?:"purchase"|"purchase_cancel";purchaseDocumentId?:number};
function recordPurchaseCost(db:Database.Database,before:Part,cost:number|null,documentId:number,event:"purchase"|"purchase_cancel"){
  db.prepare("UPDATE parts SET purchase_cost_paise=? WHERE id=?").run(cost,before.id);
  const after=listParts(db).find(p=>p.id===before.id)!;
  db.prepare("INSERT INTO part_changes(part_id,before_json,after_json) VALUES(?,?,?)")
    .run(before.id,JSON.stringify(before),JSON.stringify({...after,costEvent:event,purchaseDocumentId:documentId}));
}
function costAfterCancellation(db:Database.Database,partId:number,documentId:number){
  const rows=db.prepare("SELECT before_json,after_json FROM part_changes WHERE part_id=? ORDER BY id").all(partId) as {before_json:string;after_json:string}[];
  const events=rows.map(r=>({before:JSON.parse(r.before_json) as CostSnapshot,after:JSON.parse(r.after_json) as CostSnapshot}));
  if(!events.some(e=>e.after.costEvent==="purchase"&&e.after.purchaseDocumentId===documentId)){
    // Older records have no original-cost snapshot. Use another active purchase,
    // or mark the reference cost unknown rather than inventing a previous price.
    const latest=db.prepare(`SELECT l.unit_price AS cost FROM document_lines l JOIN documents d ON d.id=l.document_id
      WHERE l.part_id=? AND d.kind='purchase' AND d.status='posted' AND d.id<>? ORDER BY d.id DESC LIMIT 1`).get(partId,documentId) as {cost:number}|undefined;
    return latest?.cost??null;
  }
  const active=new Set((db.prepare("SELECT id FROM documents WHERE kind='purchase' AND status='posted' AND id<>?").all(documentId) as {id:number}[]).map(d=>d.id));
  let cost=events[0]?.before.purchaseCostPaise??null;
  // Replay only valid purchases and explicit manual cost edits. Ignoring prior
  // cancellation events also handles cancelling several purchases out of order.
  for(const event of events){
    if(event.after.costEvent==="purchase"){
      if(active.has(event.after.purchaseDocumentId!))cost=event.after.purchaseCostPaise;
    }else if(!event.after.costEvent&&event.before.purchaseCostPaise!==event.after.purchaseCostPaise){cost=event.after.purchaseCostPaise;}
  }
  return cost;
}
const addPartySchema=z.object({kind:z.enum(["customer","supplier"]),name:z.string().trim().min(1).max(120),phone:z.string().trim().max(30).default(""),openingBalance:amount.default(0)}).strict();
function addParty(db:Database.Database,raw:unknown){
  const v=addPartySchema.parse(raw);
  const result=db.prepare("INSERT INTO parties(kind,name,phone) VALUES(?,?,?)").run(v.kind,v.name,v.phone),partyId=Number(result.lastInsertRowid);
  if(v.openingBalance>0)db.prepare("INSERT INTO documents(kind,party_id,party_name,reference,total) VALUES(?,?,?,?,?)")
    .run(`opening_${v.kind}`,partyId,v.name,"Opening balance",v.openingBalance);
  return {partyId};
}
const postSchema=z.object({kind:z.enum(["sale","purchase"]),partyId:id.nullable().default(null),reference:z.string().trim().max(100).default(""),businessDate:z.iso.date().default(()=>dayInIndia()),
  lines:z.array(z.object({partId:id,quantity:z.number().int().min(1).max(1_000_000),unitPrice:z.number().int().min(0).max(100_000_000)}).strict()).min(1).max(100),...settlement}).strict();
function postDocument(db:Database.Database,raw:unknown){
  const v=postSchema.parse(raw);
  if(v.businessDate>dayInIndia())fail("Document date cannot be in the future.");
  if(new Set(v.lines.map(l=>l.partId)).size!==v.lines.length)fail("Combine repeated parts into one line.");
  const total=v.lines.reduce((n,l)=>n+l.quantity*l.unitPrice,0);
  if(!Number.isSafeInteger(total)||total>1_000_000_000)fail("Document total is too large.");
  const paid=v.cash+v.upi;
  if(paid>total)fail("Payment cannot exceed the document total.");
  if(v.kind==="purchase"&&!v.partyId)fail("Choose a supplier.");
  if(v.kind==="sale"&&paid<total&&!v.partyId)fail("A customer is required for credit sales.");
  const p=v.partyId?party(db,v.partyId,v.kind==="sale"?"customer":"supplier"):null;
  const parts=listParts(db);
  for(const line of v.lines){
    const part=parts.find(p=>p.id===line.partId);if(!part)fail("A selected part no longer exists.");
    if(v.kind==="sale"&&part!.quantity<line.quantity)fail(`Not enough stock for ${part!.name}. Available: ${part!.quantity}.`,409);
  }
  const documentId=Number(db.prepare("INSERT INTO documents(kind,party_id,party_name,reference,total,business_date) VALUES(?,?,?,?,?,?)")
    .run(v.kind,v.partyId,p?.name||"Walk-in",v.reference,total,v.businessDate).lastInsertRowid);
  for(const line of v.lines){
    const part=parts.find(p=>p.id===line.partId)!;
    db.prepare("INSERT INTO document_lines(document_id,part_id,description,part_number,quantity,unit_price) VALUES(?,?,?,?,?,?)")
      .run(documentId,line.partId,part.name,part.partNumber,line.quantity,line.unitPrice);
    move(db,line.partId,v.kind==="sale"?-line.quantity:line.quantity,v.kind,`Document ${documentId}`);
    if(v.kind==="purchase")recordPurchaseCost(db,part,line.unitPrice,documentId,"purchase");
  }
  if(paid>0){
    const paymentId=payment(db,v.partyId,documentId,v.kind,v.kind==="sale"?"in":"out",v.cash,v.upi,"Payment on posting");
    db.prepare("INSERT INTO allocations(payment_id,document_id,amount) VALUES(?,?,?)").run(paymentId,documentId,paid);
  }
  return {documentId};
}
const collectSchema=z.object({partyId:id,...settlement,note:z.string().trim().max(240).default("")}).strict();
function editParty(db:Database.Database,raw:unknown){
  const v=z.object({partyId:id,name:z.string().trim().min(1).max(120),phone:z.string().trim().max(30)}).strict().parse(raw);
  if(!db.prepare("SELECT id FROM parties WHERE id=?").get(v.partyId))fail("Account not found.",404);
  db.prepare("UPDATE parties SET name=?,phone=? WHERE id=?").run(v.name,v.phone,v.partyId);return {partyId:v.partyId};
}
function collect(db:Database.Database,raw:unknown){
  const v=collectSchema.parse(raw),p=db.prepare("SELECT id,kind FROM parties WHERE id=?").get(v.partyId) as Party|undefined;
  if(!p)fail("Account not found.",404);
  let remaining=v.cash+v.upi;if(remaining<=0)fail("Enter a positive payment.");
  const outstanding=documents(db).filter(d=>d.partyId===v.partyId&&d.due>0).sort((a,b)=>a.businessDate.localeCompare(b.businessDate)||a.id-b.id);
  if(remaining>outstanding.reduce((n,d)=>n+d.due,0))fail("Payment exceeds the outstanding balance.");
  const paymentId=payment(db,v.partyId,null,p!.kind==="customer"?"collection":"supplier_payment",p!.kind==="customer"?"in":"out",v.cash,v.upi,v.note);
  for(const doc of outstanding){const applied=Math.min(remaining,doc.due);if(!applied)break;
    db.prepare("INSERT INTO allocations(payment_id,document_id,amount) VALUES(?,?,?)").run(paymentId,doc.id,applied);remaining-=applied;}
  return {paymentId};
}
const returnSchema=z.object({documentId:id,reason:z.string().trim().min(3).max(240),refundCash:amount.default(0),refundUpi:amount.default(0),
  lines:z.array(z.object({lineId:id,quantity:z.number().int().min(1).max(1_000_000),saleable:z.boolean()}).strict()).min(1).max(100)}).strict();
function returnGoods(db:Database.Database,raw:unknown){
  const v=returnSchema.parse(raw),doc=getDocument(db,v.documentId);
  if(doc.kind!=="sale"||doc.status!=="posted")fail("Returns require an active original sale.");
  if(new Set(v.lines.map(l=>l.lineId)).size!==v.lines.length)fail("Each original line can appear only once.");
  let total=0;
  for(const line of v.lines){
    const original=doc.lines.find(l=>l.id===line.lineId);
    if(!original||line.quantity>original.quantity-original.returned)fail("Return quantity exceeds the remaining quantity on the original bill.",409);
    total+=original!.unitPrice*line.quantity;
  }
  const debtReduction=Math.min(doc.due,total),refund=total-debtReduction;
  if(v.refundCash+v.refundUpi!==refund)fail(`Refund must equal ${(refund/100).toFixed(2)} after reducing this bill's balance.`,409);
  const returnId=Number(db.prepare("INSERT INTO customer_returns(document_id,total,debt_reduction,refund_cash,refund_upi,reason) VALUES(?,?,?,?,?,?)")
    .run(doc.id,total,debtReduction,v.refundCash,v.refundUpi,v.reason).lastInsertRowid);
  for(const line of v.lines){
    const original=doc.lines.find(l=>l.id===line.lineId)!;
    db.prepare("INSERT INTO return_lines(return_id,line_id,quantity,saleable) VALUES(?,?,?,?)").run(returnId,line.lineId,line.quantity,line.saleable?1:0);
    if(line.saleable)move(db,original.partId,line.quantity,"return",`Return ${returnId}: ${v.reason}`);
  }
  if(refund>0)payment(db,doc.partyId,doc.id,"refund","out",v.refundCash,v.refundUpi,`Return ${returnId}`);
  return {returnId,documentId:doc.id};
}
function cancelDocument(db:Database.Database,raw:unknown){
  const v=z.object({documentId:id,reason:z.string().trim().min(3).max(240)}).strict().parse(raw),doc=getDocument(db,v.documentId);
  if(!["sale","purchase"].includes(doc.kind)||doc.status!=="posted")fail("Only active sales or purchases can be cancelled.");
  if(db.prepare("SELECT id FROM customer_returns WHERE document_id=?").get(doc.id))fail("This bill has returns. Reconcile it using the return workflow.");
  if(db.prepare("SELECT a.id FROM allocations a JOIN payments p ON p.id=a.payment_id WHERE a.document_id=? AND p.kind IN ('collection','supplier_payment')").get(doc.id))
    fail("Later payments were allocated to this document. Cancellation is blocked to protect the account history.");
  const parts=listParts(db);
  if(doc.kind==="purchase"&&doc.lines.some(l=>(parts.find(p=>p.id===l.partId)?.quantity||0)<l.quantity))fail("Received stock is no longer fully available; this purchase cannot be cancelled.");
  for(const line of doc.lines)move(db,line.partId,doc.kind==="sale"?line.quantity:-line.quantity,"cancellation",`Cancelled ${doc.number}: ${v.reason}`);
  if(doc.kind==="purchase")for(const line of doc.lines){
    const before=parts.find(p=>p.id===line.partId)!;
    recordPurchaseCost(db,before,costAfterCancellation(db,line.partId,doc.id),doc.id,"purchase_cancel");
  }
  const payments=db.prepare("SELECT cash,upi FROM payments WHERE document_id=? AND kind=?").all(doc.id,doc.kind) as {cash:number;upi:number}[];
  for(const p of payments)payment(db,doc.partyId,doc.id,doc.kind==="sale"?"sale_cancel":"purchase_cancel",doc.kind==="sale"?"out":"in",p.cash,p.upi,v.reason);
  db.prepare("UPDATE documents SET status='cancelled',cancellation_reason=?,cancelled_at=CURRENT_TIMESTAMP WHERE id=?").run(v.reason,doc.id);
  return {documentId:doc.id};
}
function settings(db:Database.Database,raw:unknown){
  const v=z.object({shopName:z.string().trim().min(1).max(120),address:z.string().trim().max(500),phone:z.string().trim().max(50)}).strict().parse(raw);
  for(const [key,value] of Object.entries(v))db.prepare("UPDATE settings SET value=? WHERE key=?").run(value,key);return {saved:true};
}
export function command(db:Database.Database,raw:unknown):Record<string,unknown>{
  const v=z.object({requestId:z.string().uuid(),action:z.enum(["party","party_edit","document","payment","return","cancel","settings"]),data:z.unknown()}).strict().parse(raw);
  const fingerprint=createHash("sha256").update(JSON.stringify({action:v.action,data:v.data})).digest("hex");
  return db.transaction(()=>{
    const previous=db.prepare("SELECT fingerprint,result_json FROM operations WHERE request_id=?").get(v.requestId) as {fingerprint:string;result_json:string}|undefined;
    if(previous){if(previous.fingerprint!==fingerprint)fail("This request key was already used for different details.",409);return JSON.parse(previous.result_json) as Record<string,unknown>;}
    const actions={party:addParty,party_edit:editParty,document:postDocument,payment:collect,return:returnGoods,cancel:cancelDocument,settings};
    const result=actions[v.action](db,v.data);
    db.prepare("INSERT INTO operations(request_id,fingerprint,result_json) VALUES(?,?,?)").run(v.requestId,fingerprint,JSON.stringify(result));
    return result;
  }).immediate();
}
