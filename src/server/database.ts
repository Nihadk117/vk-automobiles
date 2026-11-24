import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { initialiseDatabase } from "./inventory";
import { InventoryError } from "./inventory";
import { automaticBackup,backupBeforeUpgrade,restoreBytes } from "./backups";
const state = globalThis as typeof globalThis & { shopDatabase?: Database.Database;maintenance?:boolean;backupTimer?:ReturnType<typeof setInterval> };
export function getDatabase() {
  if(state.maintenance)throw new InventoryError("Restore is in progress. Please wait and reload.",503);
  if (!state.shopDatabase) {
    // Runtime data is external to the build; never trace shop databases into releases.
    const path = resolve(/* turbopackIgnore: true */ process.env.SHOP_DATABASE_PATH || "data/shop.sqlite");
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    try {
      backupBeforeUpgrade(db);initialiseDatabase(db); state.shopDatabase = db;
      void automaticBackup(db);
      if(!state.backupTimer){state.backupTimer=setInterval(()=>{if(!state.maintenance&&state.shopDatabase)void automaticBackup(state.shopDatabase);},60*60*1000);state.backupTimer.unref();}
    }
    catch (error) { db.close(); throw error; }
  }
  return state.shopDatabase;
}
export async function restoreDatabase(bytes:Buffer){
  const db=getDatabase();state.maintenance=true;
  try{return await restoreBytes(db,bytes);}finally{state.maintenance=false;}
}
