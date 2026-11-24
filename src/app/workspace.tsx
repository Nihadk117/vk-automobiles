"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { ShopUser } from "@/shared/auth";
import { shopFetch as fetch } from "./shop-fetch";
import { ShopSidebar } from "./shop-sidebar";
import { SHOP_PROFILE } from "@/shared/shop-profile";
import type { Part } from "@/server/inventory";
const money=(n:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(n/100);
function parseMoney(value:string){
  if(!/^\d+(\.\d{1,2})?$/.test(value))throw new Error("Use at most two decimal places for prices.");
  const [r,d=""]=value.split(".");return Number(r)*100+Number(d.padEnd(2,"0"));
}
type Panel={kind:"add"}|{kind:"edit"|"adjust"|"history";part:Part};
type History={movements:{id:number;quantity:number;reason:string;note:string;createdAt:string}[];
  changes:{id:number;beforeJson:string;afterJson:string;createdAt:string}[]};
function HistoryPanel({part}:{part:Part}){
  const [history,setHistory]=useState<History|null>(null),[error,setError]=useState("");
  useEffect(()=>{
    const abort=new AbortController();
    fetch(`/api/parts/${part.id}`,{cache:"no-store",signal:abort.signal}).then(async r=>{
      const data=await r.json();if(!r.ok)throw new Error(data.error);setHistory(data);
    }).catch(e=>{if(e.name!=="AbortError")setError(e.message);});return()=>abort.abort();
  },[part.id]);
  return <section className="entry-panel" aria-label="Part history"><h2>History: {part.name}</h2>
    {error&&<p role="alert">{error}</p>}{!history&&!error&&<p>Loading history...</p>}
    {history&&<><h3>Stock movements</h3><div className="table-scroll"><table><thead><tr><th>Date (UTC)</th><th>Change</th><th>Type / reason</th></tr></thead><tbody>
      {history.movements.map(m=><tr key={m.id}><td>{m.createdAt}</td><td>{m.quantity>0?"+":""}{m.quantity}</td><td>{m.reason}<small>{m.note}</small></td></tr>)}</tbody></table></div>
      {!history.movements.length&&<p>No stock movements. Opening stock was zero.</p>}
      <h3>Detail changes</h3>{!history.changes.length&&<p>No detail changes recorded.</p>}
      {history.changes.map(change=>{
        const before=JSON.parse(change.beforeJson) as Part,after=JSON.parse(change.afterJson) as Part;
        const fields:[keyof Part,string][]=[["name","Name"],["brand","Brand"],["partNumber","Part number"],["vehicle","Vehicles"],["rack","Rack"],["sellingPricePaise","Selling price"],["purchaseCostPaise","Purchase cost"],["lowStockLevel","Low-stock level"]];
        const display=(key:keyof Part,v:Part[keyof Part])=>v===null?"Unknown":key.endsWith("Paise")?money(Number(v)):v===""?"Not entered":String(v);
        return <div className="history-entry" key={change.id}><strong>{change.createdAt} UTC</strong><ul>{fields.filter(([k])=>before[k]!==after[k]).map(([k,label])=><li key={k}>{label}: {display(k,before[k])} → {display(k,after[k])}</li>)}</ul></div>;
      })}</>}
  </section>;
}
export function InventoryWorkspace({user}:{user:ShopUser}){
  const owner=user.role==="owner";
  const [parts,setParts]=useState<Part[]>([]),[search,setSearch]=useState("");
  const [status,setStatus]=useState("Connecting to inventory...");
  const [shopName,setShopName]=useState(SHOP_PROFILE.shopName);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const [panel,setPanel]=useState<Panel|null>(null),[duplicate,setDuplicate]=useState(false),[counted,setCounted]=useState(0);
  const lock=useRef(false),anchor=useRef<HTMLElement>(null);
  useEffect(()=>{
    const abort=new AbortController();
    Promise.all([fetch("/api/parts",{cache:"no-store",signal:abort.signal}),fetch("/api/shop",{cache:"no-store",signal:abort.signal})]).then(async([r,settingsResponse])=>{
      const data=await r.json(),shop=await settingsResponse.json();if(!r.ok||!settingsResponse.ok)throw new Error(data.error||shop.error);
      setParts(data.parts);setShopName(shop.settings.shopName);document.title=`${shop.settings.shopName} | Inventory`;setStatus("Local database connected");
    }).catch(e=>{if(e.name!=="AbortError"){setError(e.message);setStatus("Connection unavailable");}})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();
  },[]);
  function open(next:Panel|null){
    if(lock.current)return;setPanel(next);setError("");setDuplicate(false);
    if(next?.kind==="adjust")setCounted(next.part.quantity);
    if(next)requestAnimationFrame(()=>anchor.current?.scrollIntoView({behavior:"smooth",block:"start"}));
  }
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(lock.current||!panel||panel.kind==="history")return;
    const selection=panel,values=new FormData(event.currentTarget);setError("");
    try{
      let url="/api/parts",method="POST",body:unknown;
      if(selection.kind==="adjust"){
        url+=`/${selection.part.id}/adjustments`;
        body={revision:selection.part.revision,countedQuantity:Number(values.get("counted")),reason:values.get("reason")};
      }else{
        const cost=String(values.get("cost")||"");
        body={name:values.get("name"),brand:values.get("brand"),vehicle:values.get("vehicle"),rack:values.get("rack"),
          partNumber:values.get("partNumber"),sellingPricePaise:parseMoney(String(values.get("price"))),
          purchaseCostPaise:cost===""?null:parseMoney(cost),lowStockLevel:Number(values.get("lowStockLevel")),
          ...(selection.kind==="edit"?{revision:selection.part.revision}:{openingQuantity:Number(values.get("quantity"))})};
        if(selection.kind==="edit"){url+=`/${selection.part.id}`;method="PATCH";}
      }
      lock.current=true;setSaving(true);
      const response=await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Save failed.");
      setParts(previous=>[...previous.filter(p=>p.id!==data.part.id),data.part].sort((a,b)=>a.name.localeCompare(b.name)));
      setStatus(selection.kind==="adjust"?"Stock adjustment recorded":selection.kind==="edit"?"Part details updated; quantity unchanged":"Part and opening stock saved");setPanel(null);
    }catch(e){setError(e instanceof Error?e.message:"Reload and check stock before retrying.");}
    finally{lock.current=false;setSaving(false);}
  }
  const selected=panel&&panel.kind!=="add"?panel.part:null,isEdit=panel?.kind==="edit";
  const filtered=parts.filter(p=>[p.name,p.brand,p.vehicle,p.rack,p.partNumber,`SP-${String(p.id).padStart(4,"0")}`].some(v=>v.toLowerCase().includes(search.trim().toLowerCase())));
  return <div className="app-shell"><ShopSidebar active="/" shopName={shopName} user={user}/>
    <div className="content-shell"><header className="topbar"><span>{shopName} / Inventory</span><span>{status}</span></header><main>
      <div className="heading"><div><p className="eyebrow">INVENTORY MANAGEMENT</p><h1>Parts & stock</h1><p>Find parts, check rack locations and keep stock accurate.</p></div>
        {owner&&<button className="primary" onClick={()=>open(panel?.kind==="add"?null:{kind:"add"})} disabled={loading||saving} aria-expanded={panel?.kind==="add"}>{panel?.kind==="add"?"Close form":"+ Add a part"}</button>}</div>
      <div className="foundation-note"><span className="badge">LOCAL WORKSPACE</span> Review stock counts before billing. Keep a downloaded backup outside this computer.</div>
      {error&&<p className="error" role="alert">{error} <button type="button" onClick={()=>window.location.reload()}>Reload inventory</button></p>}
      <section ref={anchor} className="panel-anchor">
      {panel&&(panel.kind==="add"||panel.kind==="edit")&&<section className="entry-panel" aria-label={isEdit?"Edit part":"Add part"} key={selected?.id||"new"}>
        <h2>{isEdit?`Edit: ${selected?.name}`:"New part & opening stock"}</h2><p>{isEdit?"Update details and default prices here. Use Adjust stock to correct quantities.":"Count the rack first, then review details and opening quantity before saving."}</p>
        <form onSubmit={save} onChange={event=>{
          if(isEdit)return;const v=new FormData(event.currentTarget),normal=(s:unknown)=>String(s||"").trim().toLowerCase();
          setDuplicate(parts.some(p=>(normal(v.get("partNumber"))!==""&&normal(p.partNumber)===normal(v.get("partNumber")))||(normal(p.name)===normal(v.get("name"))&&normal(p.brand)===normal(v.get("brand")))));
        }}><fieldset disabled={saving}><div className="form-grid">
          <label>Part name<input name="name" required maxLength={120} defaultValue={selected?.name||""}/></label>
          <label>Brand (optional)<input name="brand" maxLength={80} defaultValue={selected?.brand||""}/></label>
          <label>Part number (optional)<input name="partNumber" maxLength={80} defaultValue={selected?.partNumber||""}/></label>
          <label className="wide-field">Compatible vehicles (optional)<input name="vehicle" maxLength={240} placeholder="Shop-confirmed models, separated by commas" defaultValue={selected?.vehicle||""}/></label>
          <label>Rack<input name="rack" required maxLength={30} defaultValue={selected?.rack||""}/></label>
          {!isEdit&&<label>Opening quantity<input name="quantity" required type="number" min="0" max="1000000" step="1" defaultValue="0"/></label>}
          <label>Selling price (₹)<input name="price" required type="number" min="0" max="1000000" step="0.01" defaultValue={selected?(selected.sellingPricePaise/100).toFixed(2):""}/></label>
          <label>Purchase cost (₹, optional)<input name="cost" type="number" min="0" max="1000000" step="0.01" placeholder="Unknown" defaultValue={selected?.purchaseCostPaise!=null?(selected.purchaseCostPaise/100).toFixed(2):""}/></label>
          <label>Low-stock level<input name="lowStockLevel" required type="number" min="0" max="1000000" step="1" defaultValue={selected?.lowStockLevel||0}/></label>
        </div>{duplicate&&<p className="warning" role="status">A similar name/brand or part number already exists. Check the catalogue before adding another record.</p>}
        {!isEdit&&<label className="confirm"><input type="checkbox" required/>I have reviewed the part details and counted the opening stock.</label>}
        {isEdit&&<p>Current stock: <strong>{selected?.quantity} pieces</strong> — editing details will not change it.</p>}
        <div className="form-actions"><button type="button" onClick={()=>open(null)}>Cancel</button><button className="primary">{saving?"Saving...":isEdit?"Save changes":"Save part & stock"}</button></div></fieldset></form></section>}
      {panel?.kind==="adjust"&&<section className="entry-panel" aria-label="Adjust stock"><h2>Adjust stock: {panel.part.name}</h2><p>Enter the quantity physically counted on the rack. The correction preserves the original opening stock.</p>
        <form onSubmit={save}><fieldset disabled={saving}><div className="form-grid"><label>Counted quantity<input name="counted" type="number" min="0" max="1000000" step="1" required value={counted} onChange={e=>setCounted(Number(e.target.value))}/></label><label className="wide-field">Reason for correction<input name="reason" required minLength={3} maxLength={240} placeholder="e.g. Opening count entered incorrectly"/></label></div>
        <p className="adjustment-summary">Current: {panel.part.quantity} · Counted: {counted} · Change: {counted-panel.part.quantity>0?"+":""}{counted-panel.part.quantity} pieces</p>
        <div className="form-actions"><button type="button" onClick={()=>open(null)}>Cancel</button><button className="primary" disabled={counted===panel.part.quantity}>{saving?"Saving...":"Record adjustment"}</button></div></fieldset></form></section>}
      {panel?.kind==="history"&&<><button className="close-history" onClick={()=>open(null)}>Close history</button><HistoryPanel key={panel.part.id} part={panel.part}/></>}
      </section>
      <section className="inventory-panel" aria-label="Parts catalogue"><div className="inventory-toolbar"><label className="search">Search catalogue<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, part number, vehicle, brand or rack..."/></label><span className="count">{parts.length} parts · {parts.reduce((n,p)=>n+p.quantity,0)} pieces</span></div>
        <div className="table-scroll"><table><thead><tr><th>PART / BRAND</th><th>COMPATIBLE VEHICLES</th><th>RACK</th><th className="number">IN STOCK</th><th className="number">SELLING PRICE</th><th>ACTIONS</th></tr></thead><tbody>
          {filtered.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small>SP-{String(p.id).padStart(4,"0")} · {p.brand||"Brand not entered"}</small>{p.partNumber&&<small>Part no: {p.partNumber}</small>}</td><td>{p.vehicle||"Not entered"}</td><td><span className="rack">{p.rack}</span></td><td className="number">{p.quantity} <small>pieces</small>{p.quantity<=p.lowStockLevel&&<span className="low-stock">Low stock</span>}</td><td className="number">{money(p.sellingPricePaise)}</td><td><div className="row-actions">{owner&&<><button disabled={saving} onClick={()=>open({kind:"edit",part:p})}>Edit</button><button disabled={saving} onClick={()=>open({kind:"adjust",part:p})}>Adjust stock</button></>}<button disabled={saving} onClick={()=>open({kind:"history",part:p})}>History</button></div></td></tr>)}</tbody></table></div>
        {!filtered.length&&<div className="empty"><span className="empty-symbol" aria-hidden="true">▤</span><h2>{loading?"Opening inventory...":parts.length?"No matching parts":"Start with your first rack"}</h2><p>{loading?"Reading the local database.":parts.length?"Try a different name, vehicle or rack.":"Add a part and its counted quantity. Your catalogue will grow one rack at a time."}</p></div>}
        <div className="table-footer">{filtered.length} matching parts <span>Quantities are individual pieces</span></div></section>
      <p className="bottom-note" role="status">{status}. Records stay on this computer. Manage backups in Settings & backup.</p>
    </main></div></div>;
}
