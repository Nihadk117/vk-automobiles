"use client";
import { useState,useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { USERNAME_PATTERN } from "@/shared/auth";
import { SHOP_PROFILE,SHOP_CATEGORY } from "@/shared/shop-profile";
const subscribe=()=>()=>{};
export function LoginForm({setup}:{setup:boolean}){
  const ready=useSyncExternalStore(subscribe,()=>true,()=>false);
  const [recover,setRecover]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[code,setCode]=useState(""),[recoveredName,setRecoveredName]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;const form=new FormData(e.currentTarget);setBusy(true);setError("");
    if((setup||recover)&&form.get("password")!==form.get("confirm")){setError("The passwords do not match.");setBusy(false);return;}
    try{const data=recover?{recoveryCode:form.get("recoveryCode"),password:form.get("password")}:{username:form.get("username"),password:form.get("password")};
      const r=await fetch("/api/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:setup?"setup":recover?"recover":"login",data})}),result=await r.json();if(!r.ok)throw new Error(result.error||"Unable to sign in.");
      if(result.recoveryCode){setCode(result.recoveryCode);setRecoveredName(result.username||"");}else window.location.replace("/shop/home");
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <main className="login-shell"><section className="login-card"><div className="login-brand"><span className="brand-mark">VK</span><div><strong>{SHOP_PROFILE.shopName}</strong><p>{SHOP_CATEGORY}</p></div></div>
    {code?<><h1>Keep your recovery code safe</h1><p>This code can reset the owner password. Save it somewhere private, away from the shop computer. It is shown only now.</p><label htmlFor="recovery-code">Recovery code</label><textarea id="recovery-code" readOnly rows={3} value={code} onFocus={e=>e.target.select()}/>{recoveredName&&<p>Owner username: <strong>{recoveredName}</strong>. Your previous recovery code no longer works.</p>}<label className="confirm"><input type="checkbox" required id="saved-code"/>I have saved the recovery code securely.</label><button className="primary" onClick={()=>{if((document.getElementById("saved-code") as HTMLInputElement).checked)window.location.replace(setup?"/shop/home":"/login");else setError("Confirm that you have saved the recovery code.");}}>Continue</button></>:<><h1>{setup?"Create the owner account":recover?"Recover owner access":"Sign in to your shop"}</h1><p>{setup?"Choose your own username and a password of at least 12 characters. There is no default password.":recover?"Use the recovery code saved when the owner account was created.":"Use your owner or staff account. Login works offline."}</p><form method="post" onSubmit={e=>void submit(e)}><fieldset disabled={busy||!ready}>
      {recover?<label>Recovery code<input name="recoveryCode" required autoComplete="off" maxLength={100}/></label>:<label>Username<input name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={setup?3:1} maxLength={40} pattern={setup?USERNAME_PATTERN:undefined}/></label>}
      <label>{recover?"New password":"Password"}<input name="password" type="password" required minLength={setup||recover?12:1} maxLength={128} autoComplete={setup||recover?"new-password":"current-password"}/></label>
      {(setup||recover)&&<label>Confirm password<input name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>}
      <button className="primary" disabled={busy}>{busy?"Please wait...":setup?"Create owner account":recover?"Reset owner password":"Sign in"}</button>
    </fieldset></form>{!setup&&<button className="text-button" disabled={busy} onClick={()=>{setRecover(!recover);setError("");}}>{recover?"Back to sign in":"Forgot owner password?"}</button>}</>}
    {error&&<p className="error" role="alert">{error}</p>}<p className="login-footnote">Local shop access · Automatic lock after 15 minutes without activity</p>
  </section></main>;
}
