import type { Part } from "../server/inventory";
const normalise=(value:string)=>value.normalize("NFKC").toLocaleLowerCase("en").trim();
const compact=(value:string)=>value.replace(/[^\p{L}\p{N}]/gu,"");
export function searchParts(parts:Part[],query:string):Part[]{
  const terms=normalise(query).split(/\s+/).filter(Boolean);
  if(!terms.length)return parts;
  return parts.filter(part=>{
    const fields=[part.name,part.brand,part.vehicle,part.partNumber,part.rack,`SP-${String(part.id).padStart(4,"0")}`];
    const text=fields.flatMap(field=>{const value=normalise(field);return [value,compact(value)];}).join(" ");
    return terms.every(term=>text.includes(term));
  });
}
