"use client";
import { useId,useMemo,useRef,useState } from "react";
import type { KeyboardEvent } from "react";
import type { Part } from "@/server/inventory";
import { searchParts } from "@/shared/part-search";
import { formatMoney } from "@/shared/shop";

export function PartFinder({parts,purchase,onAdd}:{parts:Part[];purchase:boolean;onAdd:(id:number)=>boolean}){
  const [query,setQuery]=useState(""),[choice,setChoice]=useState("");
  const fieldId=useId(),resultsId=useId(),input=useRef<HTMLInputElement>(null);
  const matches=useMemo(()=>searchParts(parts,query),[parts,query]);
  const selected=matches.find(p=>String(p.id)===choice);
  function clear(){setQuery("");setChoice("");input.current?.focus();}
  function add(part:Part){if(onAdd(part.id))clear();}
  function keyDown(event:KeyboardEvent<HTMLInputElement>){
    if(event.key==="Escape"){event.preventDefault();clear();}
    if(event.key==="Enter"){
      // Search must never submit the surrounding bill. Only an unambiguous
      // result can be added with Enter; multiple matches need an explicit choice.
      event.preventDefault();if(query.trim()&&matches.length===1)add(matches[0]);
    }
  }
  return <div className="part-picker">
    <div className="part-search-field"><label htmlFor={fieldId}>Find a part</label><div className="part-search-input">
      <input id={fieldId} ref={input} type="search" autoComplete="off" value={query} onKeyDown={keyDown}
        aria-controls={query.trim()?resultsId:undefined} placeholder="Name, brand, vehicle, part number or rack"
        onChange={e=>{setQuery(e.target.value);setChoice("");}}/>
      {query&&<button type="button" onClick={clear}>Clear search</button>}
    </div></div>
    <label>Part<select value={selected?choice:""} onChange={e=>setChoice(e.target.value)}>
      <option value="">Choose a part</option>{matches.map(p=><option key={p.id} value={p.id}>{p.name} · {p.brand||"No brand"} · {p.partNumber||`SP-${String(p.id).padStart(4,"0")}`} · {p.rack} · {p.quantity} available</option>)}
    </select></label>
    <button type="button" onClick={()=>{if(selected)add(selected);}} disabled={!selected}>Add line</button>
    {query.trim()&&<section id={resultsId} className="part-search-results" role="region" aria-label="Matching parts">
      <p role="status" aria-live="polite">{matches.length} matching {matches.length===1?"part":"parts"}{matches.length>12?" — showing the first 12; refine your search for more.":""}</p>
      {!matches.length?<p>No parts match your search.</p>:<ul>{matches.slice(0,12).map(p=>{
        const price=purchase?p.purchaseCostPaise:p.sellingPricePaise;
        return <li key={p.id}><button type="button" className="part-match" onClick={()=>add(p)}
          aria-label={`Add ${p.name}, ${p.brand||"no brand"}, ${p.partNumber||`SP-${p.id}`}, rack ${p.rack}`}>
          <span className="part-match-name">{p.name}</span><span className="part-match-meta">{p.brand||"No brand"} · {p.partNumber||`SP-${String(p.id).padStart(4,"0")}`} · Rack {p.rack} · {p.quantity} available</span>
          <span className="part-match-meta">{p.vehicle||"Vehicle compatibility not entered"}</span>
          <span className="part-match-price">{purchase?"Cost":"Price"}: {price===null?"Not entered":formatMoney(price)} · Click to add</span>
        </button></li>;
      })}</ul>}
    </section>}
  </div>;
}
