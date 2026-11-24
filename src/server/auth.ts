import type Database from "better-sqlite3";
import { createHash,randomBytes,scryptSync,timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { InventoryError,listParts } from "./inventory";
import type { ShopUser } from "../shared/auth";

export const IDLE_MS=15*60*1000,SESSION_MS=8*60*60*1000;
const username=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,39}$/, "Use 3–40 letters, numbers, dots, underscores or hyphens for the username.");
const password=z.string().min(12,"Use at least 12 characters for the password.").max(128);
type UserRow=ShopUser&{password_hash:string;enabled:number};
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const scryptOptions={N:32768,r:8,p:3,maxmem:64*1024*1024};
export function hashPassword(value:string){const salt=randomBytes(16).toString("hex");return `scrypt$32768$8$3$${salt}$${scryptSync(value,salt,64,scryptOptions).toString("hex")}`;}
export function verifyPassword(value:string,hash:string){
  const [algorithm,n,r,p,salt,key]=hash.split("$");if(algorithm!=="scrypt"||n!=="32768"||r!=="8"||p!=="3"||!salt||!key||!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(key))return false;
  const expected=Buffer.from(key,"hex"),actual=scryptSync(value,salt,64,scryptOptions);
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
const dummyHash=`scrypt$32768$8$3$00000000000000000000000000000000$${"00".repeat(64)}`;
export function configured(db:Database.Database){return !!db.prepare("SELECT id FROM auth_users WHERE role='owner' AND enabled=1").get();}
export function audit(db:Database.Database,user:ShopUser|null,action:string,details=""){
  db.prepare("INSERT INTO auth_audit(actor_id,actor_name,action,details) VALUES(?,?,?,?)").run(user?.id??null,user?.username??"Signed out",action,details.slice(0,500));
}
function safeUser(row:ShopUser):ShopUser{return {id:row.id,username:row.username,role:row.role};}
function throttle(db:Database.Database,bucket:string,now:number){
  for(const key of [bucket,"all"]){const row=db.prepare("SELECT attempts,window_start FROM auth_failures WHERE bucket=?").get(key) as {attempts:number;window_start:number}|undefined;
    if(row&&now-row.window_start<15*60*1000&&row.attempts>=(key==="all"?30:5))throw new InventoryError("Too many unsuccessful attempts. Wait 15 minutes before trying again.",429);}
}
function failed(db:Database.Database,bucket:string,now:number){
  for(const key of [bucket,"all"])db.prepare(`INSERT INTO auth_failures(bucket,attempts,window_start) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN ?-window_start>=900000 THEN 1 ELSE attempts+1 END,window_start=CASE WHEN ?-window_start>=900000 THEN ? ELSE window_start END`).run(key,now,now,now,now);
  audit(db,null,"login.failed");
}
function startSession(db:Database.Database,user:ShopUser,now:number){
  db.prepare("DELETE FROM auth_sessions WHERE created_at<? OR last_seen<?").run(now-SESSION_MS,now-IDLE_MS);
  const token=randomBytes(32).toString("hex");db.prepare("INSERT INTO auth_sessions VALUES(?,?,?,?)").run(digest(token),user.id,now,now);
  audit(db,user,"login.succeeded");return {user:safeUser(user),token};
}
export function setupOwner(db:Database.Database,raw:unknown,now=Date.now()){
  const input=z.object({username,password}).parse(raw);
  return db.transaction(()=>{
    if(configured(db))throw new InventoryError("The owner account has already been created. Sign in instead.",409);
    const result=db.prepare("INSERT INTO auth_users(username,role,password_hash) VALUES(?,'owner',?)").run(input.username,hashPassword(input.password));
    const user:ShopUser={id:Number(result.lastInsertRowid),username:input.username,role:"owner"};
    const recoveryCode=randomBytes(24).toString("hex");
    db.prepare("INSERT INTO auth_config VALUES('recovery_hash',?)").run(hashPassword(recoveryCode));audit(db,user,"owner.created");
    return {...startSession(db,user,now),recoveryCode};
  }).immediate();
}
export function login(db:Database.Database,raw:unknown,now=Date.now()){
  const input=z.object({username:z.string().trim().toLowerCase().max(100),password:z.string().max(128)}).parse(raw);
  const bucket=`login:${digest(input.username)}`;throttle(db,bucket,now);
  const user=db.prepare("SELECT * FROM auth_users WHERE username=?").get(input.username) as UserRow|undefined;
  const valid=verifyPassword(input.password,user?.password_hash??dummyHash);
  if(!valid||!user?.enabled){failed(db,bucket,now);throw new InventoryError("Username or password is incorrect.",401);}
  db.prepare("DELETE FROM auth_failures WHERE bucket=?").run(bucket);return startSession(db,user,now);
}
export function sessionUser(db:Database.Database,token:string|undefined,now=Date.now(),touch=true):ShopUser|null{
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const row=db.prepare(`SELECT u.id,u.username,u.role,s.created_at,s.last_seen FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND u.enabled=1`).get(digest(token)) as (ShopUser&{created_at:number;last_seen:number})|undefined;
  if(!row)return null;
  if(now-row.created_at>=SESSION_MS||now-row.last_seen>=IDLE_MS){db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(digest(token));return null;}
  if(touch)db.prepare("UPDATE auth_sessions SET last_seen=? WHERE token_hash=?").run(now,digest(token));
  return safeUser(row);
}
export function logout(db:Database.Database,token:string|undefined){
  const user=sessionUser(db,token,Date.now(),false);if(token)db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(digest(token));if(user)audit(db,user,"logout");
}
export function requireOwner(user:ShopUser){if(user.role!=="owner")throw new InventoryError("The owner must sign in to perform this action.",403);}
export function authorizeCommand(db:Database.Database,user:ShopUser,raw:unknown){
  if(user.role==="owner")return;
  const input=z.object({action:z.string(),data:z.record(z.string(),z.unknown())}).passthrough().parse(raw);
  if(input.action==="document"){
    if(!["sale","purchase"].includes(String(input.data.kind)))throw new InventoryError("Opening balances require the owner.",403);
    if(input.data.kind==="sale"){
      const lines=z.array(z.object({partId:z.number(),unitPrice:z.number()})).parse(input.data.lines),parts=listParts(db);
      if(lines.some(l=>parts.find(p=>p.id===l.partId)?.sellingPricePaise!==l.unitPrice))throw new InventoryError("A selling-price override requires the owner. Sign in as the owner to change the price.",403);
    }
    return;
  }
  if(input.action==="payment")return;
  // Staff can add a contact, but cannot enter or change opening debts.
  if(input.action==="party"&&!input.data.id&&Number(input.data.openingBalance??0)===0)return;
  throw new InventoryError("The owner must sign in to perform this action.",403);
}
export function manageUser(db:Database.Database,actor:ShopUser,raw:unknown){
  requireOwner(actor);
  const input=z.object({id:z.number().int().positive().optional(),username:username.optional(),password:password.optional(),enabled:z.boolean().optional()}).parse(raw);
  return db.transaction(()=>{
    if(!input.id){if(!input.username||!input.password)throw new InventoryError("Enter a username and password.",400);
      if(db.prepare("SELECT id FROM auth_users WHERE username=?").get(input.username))throw new InventoryError("That username is already in use.",409);
      const result=db.prepare("INSERT INTO auth_users(username,role,password_hash) VALUES(?,'staff',?)").run(input.username,hashPassword(input.password));audit(db,actor,"staff.created",String(result.lastInsertRowid));return;
    }
    const target=db.prepare("SELECT * FROM auth_users WHERE id=?").get(input.id) as UserRow|undefined;
    if(!target||target.role!=="staff")throw new InventoryError("Choose a staff account. Change your own password separately.",400);
    if(input.password)db.prepare("UPDATE auth_users SET password_hash=? WHERE id=?").run(hashPassword(input.password),input.id);
    if(input.enabled!==undefined)db.prepare("UPDATE auth_users SET enabled=? WHERE id=?").run(Number(input.enabled),input.id);
    db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(input.id);audit(db,actor,"staff.updated",`${target.username}; ${input.password?"password reset; ":""}${input.enabled===undefined?"":input.enabled?"enabled":"disabled"}`);
  }).immediate();
}
export function changePassword(db:Database.Database,user:ShopUser,raw:unknown){
  const input=z.object({currentPassword:z.string().max(128),password}).parse(raw),now=Date.now(),bucket=`password:${user.id}`;throttle(db,bucket,now);
  const row=db.prepare("SELECT password_hash FROM auth_users WHERE id=?").get(user.id) as {password_hash:string};
  if(!verifyPassword(input.currentPassword,row.password_hash)){failed(db,bucket,now);throw new InventoryError("Current password is incorrect.",400);}
  db.transaction(()=>{db.prepare("UPDATE auth_users SET password_hash=? WHERE id=?").run(hashPassword(input.password),user.id);db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(user.id);audit(db,user,"password.changed");}).immediate();
}
export function recoverOwner(db:Database.Database,raw:unknown,now=Date.now()){
  const input=z.object({recoveryCode:z.string().trim().toLowerCase().max(100),password}).parse(raw);throttle(db,"recovery",now);
  const row=db.prepare("SELECT value FROM auth_config WHERE key='recovery_hash'").get() as {value:string}|undefined;
  if(!verifyPassword(input.recoveryCode,row?.value??dummyHash)){failed(db,"recovery",now);throw new InventoryError("Recovery code is incorrect.",401);}
  return db.transaction(()=>{
    const owner=db.prepare("SELECT id,username,role FROM auth_users WHERE role='owner' AND enabled=1").get() as ShopUser|undefined;
    if(!owner)throw new InventoryError("Create the owner account first.",400);
    db.prepare("UPDATE auth_users SET password_hash=? WHERE id=?").run(hashPassword(input.password),owner.id);
    const recoveryCode=randomBytes(24).toString("hex");db.prepare("UPDATE auth_config SET value=? WHERE key='recovery_hash'").run(hashPassword(recoveryCode));
    db.prepare("DELETE FROM auth_sessions").run();db.prepare("DELETE FROM auth_failures").run();audit(db,owner,"owner.recovered");return {recoveryCode,username:owner.username};
  }).immediate();
}
