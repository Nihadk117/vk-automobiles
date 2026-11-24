import Database from "better-sqlite3";
import { z } from "zod";
import { initialiseShop,syncVehicles } from "./shop-schema";
import { initialiseAuth } from "./auth-schema";

export const partDetails = z.object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).default(""),
  vehicle: z.string().trim().max(240).default(""),
  rack: z.string().trim().min(1).max(30),
  sellingPricePaise: z.number().int().min(0).max(100_000_000),
  partNumber: z.string().trim().max(80).default(""),
  purchaseCostPaise: z.number().int().min(0).max(100_000_000).nullable().default(null),
  lowStockLevel: z.number().int().min(0).max(1_000_000).default(0),
}).strict();
export const partInput = partDetails.extend({openingQuantity:z.number().int().min(0).max(1_000_000)});
export const editInput = partDetails.extend({revision:z.number().int().positive()});
export const adjustmentInput = z.object({
  revision:z.number().int().positive(),
  countedQuantity:z.number().int().min(0).max(1_000_000),
  reason:z.string().trim().min(3).max(240),
}).strict();
export class InventoryError extends Error {
  constructor(message:string,public status:number){super(message);}
}
export type Part = {
  id: number; name: string; brand: string; vehicle: string; rack: string;
  sellingPricePaise: number; quantity: number; partNumber:string;
  purchaseCostPaise:number|null; lowStockLevel:number; revision:number;
};
export function initialiseDatabase(db: Database.Database) {
  db.pragma("foreign_keys = ON"); db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000");
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 1").get()) {
      db.exec(`CREATE TABLE parts (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        brand TEXT NOT NULL DEFAULT '', vehicle TEXT NOT NULL DEFAULT '', rack TEXT NOT NULL,
        selling_price_paise INTEGER NOT NULL CHECK(selling_price_paise >= 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE stock_movements (
          id INTEGER PRIMARY KEY, part_id INTEGER NOT NULL REFERENCES parts(id),
          quantity INTEGER NOT NULL CHECK(quantity <> 0), reason TEXT NOT NULL CHECK(reason = 'opening'),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE UNIQUE INDEX one_opening_per_part ON stock_movements(part_id) WHERE reason = 'opening';
        CREATE INDEX stock_by_part ON stock_movements(part_id);
        INSERT INTO schema_migrations(version) VALUES (1);`);
    }
    if (!db.prepare("SELECT version FROM schema_migrations WHERE version = 2").get()) {
      db.exec(`ALTER TABLE parts ADD COLUMN part_number TEXT NOT NULL DEFAULT '';
        ALTER TABLE parts ADD COLUMN purchase_cost_paise INTEGER CHECK(purchase_cost_paise >= 0);
        ALTER TABLE parts ADD COLUMN low_stock_level INTEGER NOT NULL DEFAULT 0 CHECK(low_stock_level >= 0);
        ALTER TABLE parts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
        CREATE TABLE stock_movements_v2 (
          id INTEGER PRIMARY KEY, part_id INTEGER NOT NULL REFERENCES parts(id),
          quantity INTEGER NOT NULL CHECK(quantity <> 0),
          reason TEXT NOT NULL CHECK(reason IN ('opening','adjustment')),
          note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK(reason <> 'adjustment' OR length(trim(note)) >= 3));
        INSERT INTO stock_movements_v2(id,part_id,quantity,reason,created_at)
          SELECT id,part_id,quantity,reason,created_at FROM stock_movements;
        DROP TABLE stock_movements;
        ALTER TABLE stock_movements_v2 RENAME TO stock_movements;
        CREATE UNIQUE INDEX one_opening_per_part ON stock_movements(part_id) WHERE reason = 'opening';
        CREATE INDEX stock_by_part ON stock_movements(part_id);
        CREATE TABLE part_changes (
          id INTEGER PRIMARY KEY,part_id INTEGER NOT NULL REFERENCES parts(id),
          before_json TEXT NOT NULL,after_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO schema_migrations(version) VALUES (2);`);
    }
    initialiseShop(db);
    initialiseAuth(db);
  }).immediate();
}
export function listParts(db: Database.Database): Part[] {
  return db.prepare(`SELECT p.id,p.name,p.brand,p.vehicle,p.rack,
    p.selling_price_paise AS sellingPricePaise,p.part_number AS partNumber,
    p.purchase_cost_paise AS purchaseCostPaise,p.low_stock_level AS lowStockLevel,p.revision,
    COALESCE(SUM(m.quantity),0) AS quantity
    FROM parts p LEFT JOIN stock_movements m ON m.part_id=p.id
    GROUP BY p.id ORDER BY p.name COLLATE NOCASE,p.id`).all() as Part[];
}
export function addPart(db: Database.Database, raw: unknown): Part {
  const input = partInput.parse(raw);
  return db.transaction(() => {
    const result = db.prepare(`INSERT INTO parts(name,brand,vehicle,rack,selling_price_paise,part_number,purchase_cost_paise,low_stock_level) VALUES (?,?,?,?,?,?,?,?)`)
      .run(input.name,input.brand,input.vehicle,input.rack,input.sellingPricePaise,input.partNumber,input.purchaseCostPaise,input.lowStockLevel);
    const id = Number(result.lastInsertRowid);
    syncVehicles(db,id,input.vehicle);
    if (input.openingQuantity > 0) db.prepare("INSERT INTO stock_movements(part_id,quantity,reason) VALUES (?,?,'opening')").run(id,input.openingQuantity);
    return { id,name:input.name,brand:input.brand,vehicle:input.vehicle,rack:input.rack,
      sellingPricePaise:input.sellingPricePaise,quantity:input.openingQuantity,
      partNumber:input.partNumber,purchaseCostPaise:input.purchaseCostPaise,lowStockLevel:input.lowStockLevel,revision:1 };
  }).immediate();
}

function currentPart(db:Database.Database,id:number,revision?:number){
  const part=listParts(db).find(p=>p.id===id);
  if(!part)throw new InventoryError("Part not found.",404);
  if(revision!==undefined&&part.revision!==revision)
    throw new InventoryError("This part changed since you opened it. Reload and review before saving.",409);
  return part;
}
export function editPart(db:Database.Database,id:number,raw:unknown):Part {
  const input=editInput.parse(raw);
  return db.transaction(()=>{
    const before=currentPart(db,id,input.revision);
    db.prepare(`UPDATE parts SET name=?,brand=?,vehicle=?,rack=?,selling_price_paise=?,
      part_number=?,purchase_cost_paise=?,low_stock_level=?,revision=revision+1 WHERE id=?`)
      .run(input.name,input.brand,input.vehicle,input.rack,input.sellingPricePaise,
        input.partNumber,input.purchaseCostPaise,input.lowStockLevel,id);
    syncVehicles(db,id,input.vehicle);
    const after=currentPart(db,id);
    db.prepare("INSERT INTO part_changes(part_id,before_json,after_json) VALUES (?,?,?)")
      .run(id,JSON.stringify(before),JSON.stringify(after));
    return after;
  }).immediate();
}
export function adjustStock(db:Database.Database,id:number,raw:unknown):Part {
  const input=adjustmentInput.parse(raw);
  return db.transaction(()=>{
    const part=currentPart(db,id,input.revision);
    const delta=input.countedQuantity-part.quantity;
    if(delta===0)throw new InventoryError("The counted quantity matches current stock. No adjustment is needed.",400);
    db.prepare("INSERT INTO stock_movements(part_id,quantity,reason,note) VALUES (?,?,'adjustment',?)")
      .run(id,delta,input.reason);
    db.prepare("UPDATE parts SET revision=revision+1 WHERE id=?").run(id);
    return currentPart(db,id);
  }).immediate();
}
export function partHistory(db:Database.Database,id:number){
  currentPart(db,id);
  return {
    movements:db.prepare("SELECT id,quantity,reason,note,created_at AS createdAt FROM stock_movements WHERE part_id=? ORDER BY id DESC").all(id),
    changes:db.prepare("SELECT id,before_json AS beforeJson,after_json AS afterJson,created_at AS createdAt FROM part_changes WHERE part_id=? ORDER BY id DESC").all(id),
  };
}
