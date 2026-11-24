"use client";
import { useEffect,useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import type { ShopUser } from "@/shared/auth";
import { IDLE_MINUTES } from "@/shared/auth";
export function SessionControls({user}:{user:ShopUser}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[locked,setLocked]=useState(false);
  async function signOut(){setBusy(true);setError("");try{
    const r=await fetch("/api/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"logout"})});
    if(!r.ok)throw new Error();
    try{localStorage.setItem("vk-logout",String(Date.now()));}catch{/* Cross-tab notification is best effort; logout already succeeded. */}
    window.location.replace("/login");
  }catch{setBusy(false);setError("Could not sign out. Retry.");}}
  useEffect(()=>{
    let lastActivity=Date.now(),lastTouch=lastActivity,ended=false,pending=false;
    function end(){if(ended)return;ended=true;window.location.replace("/login?expired=1");}
    async function check(){
      if(ended)return;
      if(Date.now()-lastActivity>=IDLE_MINUTES*60000){
        ended=true;const shell=document.querySelector<HTMLElement>(".app-shell");if(shell)shell.inert=true;
        setLocked(true);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
        try{await fetch("/api/auth",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"logout"})});}
        catch{/* Keep the screen locked even when logout cannot reach the backend. */}
        finally{clearTimeout(timer);window.location.replace("/login?expired=1");}return;
      }
      if(lastActivity>lastTouch&&Date.now()-lastTouch>=60000&&!pending){pending=true;
        try{const r=await fetch("/api/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"touch"})});if(r.status===401)end();else if(r.ok)lastTouch=Date.now();}catch{}finally{pending=false;}}
    }
    function activity(){if(Date.now()-lastActivity>=IDLE_MINUTES*60000){void check();return;}lastActivity=Date.now();}
    function storage(e:StorageEvent){if(e.key==="vk-logout")end();}
    const events=["pointerdown","keydown","pointermove","scroll"];
    for(const name of events)window.addEventListener(name,activity,{passive:true});
    window.addEventListener("storage",storage);const timer=setInterval(()=>void check(),15000);
    // Check the server when returning to a tab whose session may have ended elsewhere.
    const focus=()=>{void check();void fetch("/api/auth").then(r=>r.json()).then(data=>{if(!data.user)end();}).catch(()=>{});};window.addEventListener("focus",focus);window.addEventListener("pageshow",focus);
    return()=>{ended=true;clearInterval(timer);for(const name of events)window.removeEventListener(name,activity);window.removeEventListener("storage",storage);window.removeEventListener("focus",focus);window.removeEventListener("pageshow",focus);};
  },[]);
  return <><div className="session-controls"><span>{user.username} · {user.role==="owner"?"Owner":"Staff"}</span><Link href="/account">{user.role==="owner"?"Accounts & access":"My account"}</Link><button disabled={busy} onClick={()=>void signOut()}>{busy?"Signing out...":"Lock / sign out"}</button>{error&&<p role="alert">{error}</p>}</div>{locked&&createPortal(<div className="session-lock-screen" role="dialog" aria-modal="true" aria-label="Locking workspace" tabIndex={-1} ref={element=>element?.focus()}><p>Locking workspace...</p></div>,document.body)}</>;
}
