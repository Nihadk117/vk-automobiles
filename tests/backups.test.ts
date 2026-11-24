import Database from "better-sqlite3";
import { afterEach,beforeEach,expect,it } from "vitest";
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { addPart,initialiseDatabase,listParts } from "../src/server/inventory";
import { command,snapshot } from "../src/server/commerce";
import { automaticBackup,lastBackupError,backupBeforeUpgrade,backupBytes,createBackup,listBackups,restoreBytes,restoreFromFile } from "../src/server/backups";
import { setupOwner,login,sessionUser,manageUser } from "../src/server/auth";
let folder:string,db:Database.Database;
beforeEach(()=>{folder=mkdtempSync(join(tmpdir(),"vk-backup-test-"));db=new Database(join(folder,"shop.sqlite"));initialiseDatabase(db);});
afterEach(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
it("reports an unavailable backup directory without rejecting startup or changing stock",async()=>{
  addPart(db,{name:"Keep when backup fails",rack:"A",openingQuantity:4,sellingPricePaise:100});
  writeFileSync(join(folder,"backups"),"A file blocks creation of the backup directory");
  await expect(automaticBackup(db)).resolves.toBeUndefined();
  expect(lastBackupError).toContain("Automatic backup failed");expect(listParts(db)[0].quantity).toBe(4);
});
it("restores business records while preserving current accounts, audit and schema, and revokes sessions",async()=>{
  const owner=setupOwner(db,{username:"owner",password:"Owner-password-12345"});
  addPart(db,{name:"Original",rack:"A",openingQuantity:3,sellingPricePaise:100});
  const name=await createBackup(db);
  manageUser(db,owner.user,{username:"new-staff",password:"Staff-password-12345"});
  const staff=login(db,{username:"new-staff",password:"Staff-password-12345"});
  const auditCount=(db.prepare("SELECT COUNT(*) AS n FROM auth_audit").get() as {n:number}).n;
  addPart(db,{name:"Later",rack:"B",openingQuantity:2,sellingPricePaise:200});
  await restoreBytes(db,backupBytes(db,name));
  expect(listParts(db)).toHaveLength(1);expect(sessionUser(db,staff.token)).toBeNull();
  expect(db.prepare("SELECT username FROM auth_users ORDER BY id").all()).toEqual([{username:"owner"},{username:"new-staff"}]);
  expect((db.prepare("SELECT COUNT(*) AS n FROM auth_audit").get() as {n:number}).n).toBe(auditCount);
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({version:4});
});
it("accepts a legacy version-three backup without replacing current authentication",async()=>{
  const owner=setupOwner(db,{username:"owner",password:"Owner-password-12345"});
  addPart(db,{name:"Legacy",rack:"A",openingQuantity:5,sellingPricePaise:100});const name=await createBackup(db),legacyPath=join(folder,"legacy.sqlite");
  writeFileSync(legacyPath,backupBytes(db,name));const legacy=new Database(legacyPath);
  legacy.pragma("foreign_keys=OFF");legacy.exec("DROP TABLE auth_sessions; DROP TABLE auth_users; DROP TABLE auth_config; DROP TABLE auth_audit; DROP TABLE auth_failures; DELETE FROM schema_migrations WHERE version=4;");legacy.close();
  await restoreBytes(db,readFileSync(legacyPath));expect(listParts(db)[0].quantity).toBe(5);
  expect(login(db,{username:"owner",password:"Owner-password-12345"}).user.id).toBe(owner.user.id);
});
it("restores a snapshot with reconciled stock, documents and balances, keeping recovery copy",async()=>{
  const p=addPart(db,{name:"Filter",rack:"A",openingQuantity:10,sellingPricePaise:28000});
  const party=command(db,{requestId:randomUUID(),action:"party",data:{kind:"customer",name:"Customer"}});
  command(db,{requestId:randomUUID(),action:"document",data:{kind:"sale",partyId:party.partyId,lines:[{partId:p.id,quantity:2,unitPrice:28000}],upi:20000}});
  const expected=snapshot(db),name=await createBackup(db),bytes=backupBytes(db,name);
  command(db,{requestId:randomUUID(),action:"payment",data:{partyId:party.partyId,cash:10000}});
  addPart(db,{name:"After backup",rack:"B",openingQuantity:5,sellingPricePaise:100});
  await restoreBytes(db,bytes);
  expect(snapshot(db)).toEqual(expected);expect(listParts(db)).toHaveLength(1);expect(listParts(db)[0].quantity).toBe(8);
  expect(listBackups(db).some(b=>b.name.startsWith("before-restore"))).toBe(true);
  expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
});
it("rejects non-SQLite uploads and unrelated databases without touching current stock",async()=>{
  addPart(db,{name:"Keep",rack:"A",openingQuantity:3,sellingPricePaise:100});
  await expect(restoreBytes(db,Buffer.from("invalid backup"))).rejects.toThrow("valid SQLite");
  const foreignPath=join(folder,"foreign.sqlite"),foreign=new Database(foreignPath);foreign.exec("CREATE TABLE unrelated(id INTEGER)");foreign.close();
  await expect(restoreBytes(db,readFileSync(foreignPath))).rejects.toThrow("this version");
  expect(listParts(db)[0].quantity).toBe(3);
});
it("rejects traversal in backup download names",()=>{expect(()=>backupBytes(db,"../../shop.sqlite")).toThrow("not found");});
it("takes a readable pre-upgrade snapshot before changing an older database",()=>{
  addPart(db,{name:"Keep before upgrade",rack:"A",openingQuantity:7,sellingPricePaise:100});
  db.prepare("DELETE FROM schema_migrations WHERE version>=3").run();
  backupBeforeUpgrade(db);const file=listBackups(db).find(b=>b.name.startsWith("before-upgrade"))!;
  const saved=new Database(join(folder,"backups",file.name),{readonly:true});
  try{expect(saved.pragma("quick_check",{simple:true})).toBe("ok");expect(listParts(saved)[0].quantity).toBe(7);expect(saved.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({version:2});}
  finally{saved.close();}
});
it("rolls back every restored table on copy failure and reenables foreign keys",async()=>{
  addPart(db,{name:"First",rack:"A",openingQuantity:3,sellingPricePaise:100});const name=await createBackup(db),path=join(folder,"copy.sqlite");writeFileSync(path,backupBytes(db,name));
  addPart(db,{name:"Keep second",rack:"B",openingQuantity:2,sellingPricePaise:200});
  db.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON parts BEGIN SELECT RAISE(ABORT,'restore failure'); END;");
  expect(()=>restoreFromFile(db,path)).toThrow("restore failure");expect(listParts(db)).toHaveLength(2);expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
});
