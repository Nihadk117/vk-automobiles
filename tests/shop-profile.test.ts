import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { initialiseDatabase } from "../src/server/inventory";
import { snapshot } from "../src/server/commerce";
it("initialises the supplied shop address, PIN code and phone for fresh installations",()=>{
  const db=new Database(":memory:");
  try{initialiseDatabase(db);expect(snapshot(db).settings).toEqual({shopName:"VK AutoMobiles",address:"Edavannapara, Malappuram\nPINCODE: 673645",phone:"+917025724642"});}
  finally{db.close();}
});
