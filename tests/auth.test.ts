import Database from "better-sqlite3";
import { beforeEach,afterEach,it,expect } from "vitest";
import { initialiseDatabase,addPart,listParts } from "../src/server/inventory";
import { authorizeCommand,setupOwner,login,sessionUser,logout,manageUser,changePassword,recoverOwner,hashPassword,verifyPassword,IDLE_MS,SESSION_MS } from "../src/server/auth";
let db:Database.Database;
const password="Owner-test-password-123";
beforeEach(()=>{db=new Database(":memory:");initialiseDatabase(db);});afterEach(()=>db.close());
it("creates the owner only once and stores salted password and token hashes",()=>{
  const auth=setupOwner(db,{username:"OWNER",password},1000);expect(auth.user.username).toBe("owner");
  const row=db.prepare("SELECT password_hash FROM auth_users").get() as {password_hash:string};expect(row.password_hash).not.toContain(password);expect(verifyPassword(password,row.password_hash)).toBe(true);
  expect(hashPassword(password)).not.toBe(row.password_hash);expect(db.prepare("SELECT token_hash FROM auth_sessions").get()).not.toEqual({token_hash:auth.token});
  expect(()=>setupOwner(db,{username:"intruder",password})).toThrow("already");expect(sessionUser(db,auth.token,1001)).toEqual(auth.user);
});
it("rejects weak passwords and invalid usernames without creating an account",()=>{expect(()=>setupOwner(db,{username:"ow",password})).toThrow();expect(()=>setupOwner(db,{username:"owner",password:"short"})).toThrow();expect(db.prepare("SELECT * FROM auth_users").all()).toHaveLength(0);});
it("expires idle sessions and enforces absolute expiry even while active",()=>{
  const auth=setupOwner(db,{username:"owner",password},1000);expect(sessionUser(db,auth.token,1000+IDLE_MS)).toBeNull();
  const again=login(db,{username:"owner",password},2000);for(let now=2000+60000;now<2000+SESSION_MS;now+=60000)expect(sessionUser(db,again.token,now)).not.toBeNull();expect(sessionUser(db,again.token,2000+SESSION_MS)).toBeNull();
});
it("rejects wrong passwords and limits repeated guesses across restarts",()=>{
  setupOwner(db,{username:"owner",password},1000);
  for(let i=0;i<5;i++)expect(()=>login(db,{username:"owner",password:"incorrect"},2000)).toThrow("incorrect");
  expect(()=>login(db,{username:"owner",password},3000)).toThrow("Too many");expect(login(db,{username:"owner",password},2000+900001).user.role).toBe("owner");
},20000);
it("enforces the persisted global attempt limit across different guessed usernames",()=>{
  setupOwner(db,{username:"owner",password},1000);
  // Start at the persisted boundary instead of hashing 30 identical wrong passwords.
  db.prepare("INSERT INTO auth_failures(bucket,attempts,window_start) VALUES('all',29,1000)").run();
  expect(()=>login(db,{username:"first-unknown",password:"wrong"},2000)).toThrow("incorrect");
  expect(()=>login(db,{username:"another-unknown",password},2001)).toThrow("Too many");
  expect(db.prepare("SELECT attempts FROM auth_failures WHERE bucket='all'").get()).toEqual({attempts:30});
},20000);
it("logout invalidates the server session",()=>{const auth=setupOwner(db,{username:"owner",password});logout(db,auth.token);expect(sessionUser(db,auth.token)).toBeNull();});
it("only the owner manages staff and disabling or resetting staff revokes sessions",()=>{
  const owner=setupOwner(db,{username:"owner",password}).user;manageUser(db,owner,{username:"staff",password});const staff=login(db,{username:"staff",password});
  expect(()=>manageUser(db,staff.user,{username:"another",password})).toThrow("owner");
  manageUser(db,owner,{id:staff.user.id,enabled:false});expect(sessionUser(db,staff.token)).toBeNull();expect(()=>login(db,{username:"staff",password})).toThrow("incorrect");
  manageUser(db,owner,{id:staff.user.id,enabled:true,password:"Replacement-password-123"});expect(()=>login(db,{username:"staff",password})).toThrow("incorrect");expect(login(db,{username:"staff",password:"Replacement-password-123"}).user.id).toBe(staff.user.id);
  expect(()=>manageUser(db,owner,{id:owner.id,enabled:false})).toThrow("staff");
},20000);
it("changing a password requires the current password and revokes every user session",()=>{
  const auth=setupOwner(db,{username:"owner",password});const second=login(db,{username:"owner",password});
  expect(()=>changePassword(db,auth.user,{currentPassword:"wrong",password:"New-password-12345"})).toThrow("incorrect");
  changePassword(db,auth.user,{currentPassword:password,password:"New-password-12345"});expect(sessionUser(db,auth.token)).toBeNull();expect(sessionUser(db,second.token)).toBeNull();expect(login(db,{username:"owner",password:"New-password-12345"}).user.id).toBe(auth.user.id);
},20000);
it("recovery rotates its code and revokes all sessions",()=>{
  const auth=setupOwner(db,{username:"owner",password});expect(()=>recoverOwner(db,{recoveryCode:"wrong",password})).toThrow("incorrect");
  const recovered=recoverOwner(db,{recoveryCode:auth.recoveryCode,password:"Recovered-password-123"});expect(recovered.recoveryCode).not.toBe(auth.recoveryCode);expect(sessionUser(db,auth.token)).toBeNull();
  expect(()=>recoverOwner(db,{recoveryCode:auth.recoveryCode,password})).toThrow("incorrect");expect(login(db,{username:"owner",password:"Recovered-password-123"}).user.username).toBe("owner");
},20000);
it("staff can perform routine commands but cannot override prices or sensitive actions",()=>{
  const part=addPart(db,{name:"Filter",rack:"A",openingQuantity:10,sellingPricePaise:28000});
  const staff={id:2,username:"staff",role:"staff" as const};
  for(const action of ["return","cancel","settings","party_edit"])expect(()=>authorizeCommand(db,staff,{action,data:{}})).toThrow("owner");
  expect(()=>authorizeCommand(db,staff,{action:"party",data:{openingBalance:1}})).toThrow("owner");
  expect(()=>authorizeCommand(db,staff,{action:"party",data:{openingBalance:0}})).not.toThrow();
  expect(()=>authorizeCommand(db,staff,{action:"document",data:{kind:"sale",lines:[{partId:part.id,unitPrice:100}]}})).toThrow("override");
  for(const kind of ["sale","purchase"])expect(()=>authorizeCommand(db,staff,{action:"document",data:{kind,lines:[{partId:part.id,unitPrice:28000}]}})).not.toThrow();
  expect(()=>authorizeCommand(db,staff,{action:"payment",data:{}})).not.toThrow();expect(listParts(db)[0].quantity).toBe(10);
});
it("migration preserves existing business records and creates no default user",()=>{const part=addPart(db,{name:"Keep",rack:"A",openingQuantity:7,sellingPricePaise:100});initialiseDatabase(db);expect(listParts(db)[0]).toEqual(part);expect(db.prepare("SELECT * FROM auth_users").all()).toHaveLength(0);});
