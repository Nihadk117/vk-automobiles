import { createHash } from "node:crypto";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
const label=process.argv[2];
if(!["before","after"].includes(label))throw new Error("Use before or after.");
const paths=["parts","shop"],records={};
for(const path of paths){const response=await fetch(`http://127.0.0.1:3000/api/${path}`);if(!response.ok)throw new Error(`Shop read failed: ${path}`);records[path]=await response.json();}
const proof={timestamp:new Date().toISOString(),hash:createHash("sha256").update(JSON.stringify(records)).digest("hex"),
  parts:records.parts.parts.length,parties:records.shop.parties.length,documents:records.shop.documents.length,payments:records.shop.payments.length,returns:records.shop.returns.length};
mkdirSync("qa-artifacts",{recursive:true});writeFileSync(`qa-artifacts/shop-data-${label}.json`,JSON.stringify(proof,null,2));
if(label==="after"){const before=JSON.parse(readFileSync("qa-artifacts/shop-data-before.json","utf8"));console.log(JSON.stringify({...proof,shopRecordsUnchanged:before.hash===proof.hash},null,2));}
else console.log(JSON.stringify(proof,null,2));
