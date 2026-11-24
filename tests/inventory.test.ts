import Database from "better-sqlite3";
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { addPart,adjustStock,editPart,initialiseDatabase,listParts,partHistory } from "../src/server/inventory";
let db:Database.Database;
const input={name:"Air filter",rack:"A-02",openingQuantity:10,sellingPricePaise:28000};
beforeEach(()=>{db=new Database(":memory:");initialiseDatabase(db);});
afterEach(()=>db.close());
describe("inventory transaction",()=>{
  it("records opening stock and integer paise; reading never changes stock",()=>{
    addPart(db,input);expect(listParts(db)[0]).toMatchObject({quantity:10,sellingPricePaise:28000});
    expect(listParts(db)[0].quantity).toBe(10);
    expect(db.prepare("SELECT COUNT(*) AS count FROM stock_movements").get()).toEqual({count:1});
  });
  it("rolls back the part if its stock movement fails",()=>{
    db.exec("CREATE TRIGGER simulate_failure BEFORE INSERT ON stock_movements BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
    expect(()=>addPart(db,input)).toThrow("simulated failure");expect(listParts(db)).toEqual([]);
  });
  it.each([{openingQuantity:-1},{openingQuantity:1.5},{sellingPricePaise:-1},{sellingPricePaise:0.5},{name:"  "}])("rejects invalid input %o",change=>{
    expect(()=>addPart(db,{...input,...change})).toThrow();expect(listParts(db)).toEqual([]);
  });
  it("allows zero opening stock and safely binds user input",()=>{
    const name="Filter '); DROP TABLE parts; --";addPart(db,{...input,name,openingQuantity:0});
    expect(listParts(db)[0]).toMatchObject({name,quantity:0});
  });
  it("reopening migrations preserves records",()=>{
    addPart(db,input);initialiseDatabase(db);expect(listParts(db)).toHaveLength(1);
  });
});
describe("editing and count corrections",()=>{
  function details(part:ReturnType<typeof addPart>){
    const {id,quantity,...fields}=part;
    void id;void quantity;return fields;
  }
  it("edits prices and details without rewriting stock; records before/after",()=>{
    const part=addPart(db,input);
    const updated=editPart(db,part.id,{...details(part),sellingPricePaise:31525,partNumber:"AF-001",purchaseCostPaise:0,lowStockLevel:12});
    expect(updated).toMatchObject({sellingPricePaise:31525,quantity:10,purchaseCostPaise:0,revision:2});
    const h=partHistory(db,part.id);
    expect(h.movements).toHaveLength(1);expect(h.changes).toHaveLength(1);
    expect(JSON.parse((h.changes[0] as {beforeJson:string}).beforeJson).sellingPricePaise).toBe(28000);
  });
  it("keeps an unknown purchase cost distinct from zero",()=>{
    const part=addPart(db,input);expect(part.purchaseCostPaise).toBeNull();
    expect(editPart(db,part.id,{...details(part),purchaseCostPaise:0}).purchaseCostPaise).toBe(0);
  });
  it("corrects both down and up while preserving opening stock and reasons",()=>{
    const part=addPart(db,input);
    const down=adjustStock(db,part.id,{revision:1,countedQuantity:7,reason:"Recounted rack"});
    const up=adjustStock(db,part.id,{revision:down.revision,countedQuantity:12,reason:"Found extra pieces"});
    expect(up.quantity).toBe(12);
    expect(partHistory(db,part.id).movements).toEqual(expect.arrayContaining([
      expect.objectContaining({quantity:10,reason:"opening"}),
      expect.objectContaining({quantity:-3,note:"Recounted rack"}),
      expect.objectContaining({quantity:5,note:"Found extra pieces"}),
    ]));
  });
  it("rejects stale edits and repeated adjustments without double-posting",()=>{
    const part=addPart(db,input);
    adjustStock(db,part.id,{revision:1,countedQuantity:8,reason:"Correct count"});
    expect(()=>editPart(db,part.id,details(part))).toThrow("changed since");
    expect(()=>adjustStock(db,part.id,{revision:1,countedQuantity:8,reason:"Correct count"})).toThrow("changed since");
    expect(listParts(db)[0].quantity).toBe(8);expect(partHistory(db,part.id).movements).toHaveLength(2);
  });
  it.each([{countedQuantity:-1,reason:"Correction"},{countedQuantity:1.5,reason:"Correction"},{countedQuantity:0,reason:" "}])("rejects invalid corrections %o",change=>{
    const part=addPart(db,input);expect(()=>adjustStock(db,part.id,{revision:1,...change})).toThrow();
    expect(listParts(db)[0].quantity).toBe(10);
  });
  it("rejects no-change adjustments and missing parts",()=>{
    const part=addPart(db,input);
    expect(()=>adjustStock(db,part.id,{revision:1,countedQuantity:10,reason:"Recount"})).toThrow("No adjustment");
    expect(()=>editPart(db,999,details(part))).toThrow("not found");
  });
  it("rolls back metadata edits if the history write fails",()=>{
    const part=addPart(db,input);
    db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON part_changes BEGIN SELECT RAISE(ABORT,'audit failure'); END;");
    expect(()=>editPart(db,part.id,{...details(part),name:"Changed"})).toThrow("audit failure");
    expect(listParts(db)[0]).toMatchObject({name:"Air filter",revision:1});
  });
  it("rolls back adjustment if the revision update fails",()=>{
    const part=addPart(db,input);
    db.exec("CREATE TRIGGER fail_revision BEFORE UPDATE ON parts BEGIN SELECT RAISE(ABORT,'update failure'); END;");
    expect(()=>adjustStock(db,part.id,{revision:1,countedQuantity:8,reason:"Recount"})).toThrow("update failure");
    expect(listParts(db)[0].quantity).toBe(10);expect(partHistory(db,part.id).movements).toHaveLength(1);
  });
});
it("migrates a version-one database preserving part IDs and opening stock",()=>{
  const old=new Database(":memory:");
  try {
    old.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations(version) VALUES(1);
      CREATE TABLE parts(id INTEGER PRIMARY KEY,name TEXT,brand TEXT,vehicle TEXT,rack TEXT,selling_price_paise INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE stock_movements(id INTEGER PRIMARY KEY,part_id INTEGER REFERENCES parts(id),quantity INTEGER,reason TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX stock_by_part ON stock_movements(part_id);
      CREATE UNIQUE INDEX one_opening_per_part ON stock_movements(part_id) WHERE reason='opening';
      INSERT INTO parts(id,name,brand,vehicle,rack,selling_price_paise) VALUES(42,'Existing filter','','Swift','A-01',28000);
      INSERT INTO stock_movements(id,part_id,quantity,reason) VALUES(7,42,13,'opening');`);
    initialiseDatabase(old);initialiseDatabase(old);
    expect(listParts(old)[0]).toMatchObject({id:42,quantity:13,purchaseCostPaise:null,revision:1});
    expect(partHistory(old,42).movements).toEqual([expect.objectContaining({id:7,quantity:13})]);
    expect(adjustStock(old,42,{revision:1,countedQuantity:12,reason:"Migrated recount"}).quantity).toBe(12);
  } finally {old.close();}
});
