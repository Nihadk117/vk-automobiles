export type Party={id:number;kind:"customer"|"supplier";name:string;phone:string;balance:number};
export type Line={id:number;partId:number;description:string;partNumber:string;quantity:number;unitPrice:number;returned:number};
export type Document={id:number;number:string;kind:"sale"|"purchase"|"opening_customer"|"opening_supplier";partyId:number|null;partyName:string;reference:string;total:number;paid:number;due:number;status:"posted"|"cancelled";cancellationReason:string;cancelledAt:string|null;businessDate:string;createdAt:string;lines:Line[]};
export type Payment={id:number;partyId:number|null;documentId:number|null;kind:string;direction:"in"|"out";cash:number;upi:number;note:string;createdAt:string;allocations:{documentId:number;amount:number}[]};
export type ReturnRecord={id:number;documentId:number;total:number;debtReduction:number;refundCash:number;refundUpi:number;reason:string;createdAt:string;lines:{lineId:number;description:string;quantity:number;saleable:boolean}[]};
export type ShopSettings={shopName:string;address:string;phone:string};
export type Snapshot={parties:Party[];documents:Document[];payments:Payment[];returns:ReturnRecord[];settings:ShopSettings};
export const formatMoney=(n:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(n/100);
export function csvCell(value:unknown){
  const original=String(value);
  // Prefix formula-like cells instead of replacing (and losing) their first character.
  const safe=/^[\s]*[=+@-]/.test(original)?"'"+original:original;
  return '"'+safe.replaceAll('"','""')+'"';
}
export function paise(value:string){
  if(!/^\d+(\.\d{1,2})?$/.test(value))throw new Error("Enter a valid amount with at most two decimal places.");
  const [r,d=""]=value.split(".");const n=Number(r)*100+Number(d.padEnd(2,"0"));
  if(!Number.isSafeInteger(n)||n>1_000_000_000)throw new Error("Amount is too large.");return n;
}
export const indiaDate=(date:string)=>new Date(date.includes("T")?date:date.replace(" ","T")+"Z").toLocaleString("en-IN",{timeZone:"Asia/Kolkata"});
export const dayInIndia=(date=new Date())=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
