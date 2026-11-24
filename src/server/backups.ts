import Database from "better-sqlite3";
import { mkdirSync,readdirSync,statSync,readFileSync,writeFileSync,unlinkSync,renameSync,existsSync } from "node:fs";
import { dirname,join } from "node:path";
import { randomUUID } from "node:crypto";
import { InventoryError } from "./inventory";
import { dayInIndia } from "../shared/shop";
export const backupDirectory=(db:Database.Database)=>join(dirname(db.name),"backups");
let autoRunning=false;
export let lastBackupError="";
export function backupBeforeUpgrade(db:Database.Database){
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get())return;
  const row=db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {version:number};
  if(row.version>=4)return;
  const directory=backupDirectory(db);mkdirSync(directory,{recursive:true});
  const path=join(directory,`before-upgrade-${dayInIndia()}-${Date.now()}-${randomUUID().slice(0,8)}.sqlite`);
  // VACUUM INTO provides a consistent synchronous snapshot before any migration.
  db.prepare("VACUUM INTO ?").run(path);
}
export async function createBackup(db:Database.Database,label="manual"){
  const directory=backupDirectory(db);mkdirSync(directory,{recursive:true});
  const name=`${label}-${dayInIndia()}-${Date.now()}-${randomUUID().slice(0,8)}.sqlite`;
  const pending=join(directory,name+".pending");
  try{await db.backup(pending);renameSync(pending,join(directory,name));}
  finally{if(existsSync(pending))unlinkSync(pending);}
  lastBackupError="";return name;
}
export function listBackups(db:Database.Database){
  const directory=backupDirectory(db);mkdirSync(directory,{recursive:true});
  return readdirSync(directory).filter(n=>/^[a-z0-9-]+\.sqlite$/.test(n)).map(name=>({name,bytes:statSync(join(directory,name)).size,createdAt:statSync(join(directory,name)).mtime.toISOString()})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function automaticBackup(db:Database.Database){
  if(autoRunning)return;
  autoRunning=true;
  try{
    if(listBackups(db).some(b=>b.name.startsWith(`daily-${dayInIndia()}-`)))return;
    await createBackup(db,"daily");
  }catch{lastBackupError="Automatic backup failed. Check backup storage and create a manual backup.";console.error(lastBackupError);}
  finally{autoRunning=false;}
}
export function backupBytes(db:Database.Database,name:string){
  if(!/^[a-z0-9-]+\.sqlite$/.test(name)||!listBackups(db).some(b=>b.name===name))throw new InventoryError("Backup not found.",404);
  return readFileSync(join(backupDirectory(db),name));
}
function tableNames(db:Database.Database){return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(r=>r.name).filter(name=>!name.startsWith("auth_")&&name!=="schema_migrations");}
function validateBackup(source:Database.Database,current:Database.Database){
  source.pragma("trusted_schema=OFF");
  if(source.pragma("quick_check",{simple:true})!=="ok"||(source.pragma("foreign_key_check") as unknown[]).length)throw new InventoryError("Backup failed its integrity checks.",400);
  const tables=tableNames(current);
  if(JSON.stringify(tableNames(source))!==JSON.stringify(tables))throw new InventoryError("Choose a backup made by this version of VK Automobiles.",400);
  if(source.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','view') OR sql LIKE '%VIRTUAL TABLE%'").get())throw new InventoryError("Unsupported backup objects.",400);
  const version=source.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {version:number};
  if(![3,4].includes(version.version))throw new InventoryError("Unsupported backup version.",400);
  for(const table of tables){
    if(!/^[a-z_]+$/.test(table))throw new InventoryError("Unsupported table name.",400);
    const columns=(db:Database.Database)=>(db.pragma(`table_info(${table})`) as {name:string;type:string}[]).map(c=>[c.name,c.type]);
    if(JSON.stringify(columns(source))!==JSON.stringify(columns(current)))throw new InventoryError("Backup schema does not match this application.",400);
  }
  return tables;
}
// Copy only data into the existing schema in a single transaction. A failure rolls
// back every table, and the application's current schema is never replaced.
export function restoreFromFile(db:Database.Database,path:string){
  const source=new Database(path,{readonly:true,fileMustExist:true});
  let tables:string[];
  try{tables=validateBackup(source,db);}finally{source.close();}
  db.prepare("ATTACH DATABASE ? AS restore_source").run(path);
  db.pragma("foreign_keys=OFF");
  try{
    db.transaction(()=>{
      for(const table of tables)db.exec(`DELETE FROM main.${table}; INSERT INTO main.${table} SELECT * FROM restore_source.${table};`);
      // Restoring shop records must preserve this installation's users, audit,
      // schema version and account sequences. Backup sessions never become valid.
      for(const table of tables){
        const sequence=db.prepare("SELECT seq FROM restore_source.sqlite_sequence WHERE name=?").get(table) as {seq:number}|undefined;
        db.prepare("DELETE FROM main.sqlite_sequence WHERE name=?").run(table);
        if(sequence)db.prepare("INSERT INTO main.sqlite_sequence(name,seq) VALUES(?,?)").run(table,sequence.seq);
      }
      db.prepare("DELETE FROM auth_sessions").run();
      if((db.pragma("foreign_key_check") as unknown[]).length)throw new InventoryError("Restored records have invalid references.",400);
    }).immediate();
  }finally{db.pragma("foreign_keys=ON");db.exec("DETACH DATABASE restore_source");}
}
export async function restoreBytes(db:Database.Database,bytes:Buffer){
  if(bytes.length>50*1024*1024||bytes.subarray(0,16).toString()!=="SQLite format 3\u0000")throw new InventoryError("Choose a valid SQLite backup under 50 MB.",400);
  const path=join(backupDirectory(db),`restore-stage-${randomUUID()}.sqlite`);mkdirSync(backupDirectory(db),{recursive:true});
  writeFileSync(path,bytes,{flag:"wx"});
  try{
    // Validate before touching live data or creating the recovery snapshot.
    const candidate=new Database(path,{readonly:true});try{validateBackup(candidate,db);}finally{candidate.close();}
    const recovery=await createBackup(db,"before-restore");restoreFromFile(db,path);return recovery;
  }finally{unlinkSync(path);}
}
