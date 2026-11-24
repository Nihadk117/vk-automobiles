import type Database from "better-sqlite3";
import { SHOP_PROFILE } from "../shared/shop-profile";

export function initialiseShop(db:Database.Database){
  if(db.prepare("SELECT version FROM schema_migrations WHERE version=3").get())return;
  db.exec(`CREATE TABLE stock_movements_v3 (
    id INTEGER PRIMARY KEY,part_id INTEGER NOT NULL REFERENCES parts(id),quantity INTEGER NOT NULL CHECK(quantity<>0),
    reason TEXT NOT NULL CHECK(reason IN ('opening','adjustment','sale','purchase','return','cancellation')),
    note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK(reason<>'adjustment' OR length(trim(note))>=3));
    INSERT INTO stock_movements_v3 SELECT * FROM stock_movements;
    DROP TABLE stock_movements;
    ALTER TABLE stock_movements_v3 RENAME TO stock_movements;
    CREATE UNIQUE INDEX one_opening_per_part ON stock_movements(part_id) WHERE reason='opening';
    CREATE INDEX stock_by_part ON stock_movements(part_id);
    CREATE TABLE parties(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL CHECK(kind IN ('customer','supplier')),
      name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE documents(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL CHECK(kind IN ('sale','purchase','opening_customer','opening_supplier')),
      party_id INTEGER REFERENCES parties(id),party_name TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL CHECK(total>=0),status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','cancelled')),
      cancellation_reason TEXT NOT NULL DEFAULT '',cancelled_at TEXT,business_date TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE document_lines(id INTEGER PRIMARY KEY AUTOINCREMENT,document_id INTEGER NOT NULL REFERENCES documents(id),
      part_id INTEGER NOT NULL REFERENCES parts(id),description TEXT NOT NULL,part_number TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL CHECK(quantity>0),unit_price INTEGER NOT NULL CHECK(unit_price>=0));
    CREATE TABLE payments(id INTEGER PRIMARY KEY AUTOINCREMENT,party_id INTEGER REFERENCES parties(id),document_id INTEGER REFERENCES documents(id),
      kind TEXT NOT NULL CHECK(kind IN ('sale','purchase','collection','supplier_payment','refund','sale_cancel','purchase_cancel')),
      direction TEXT NOT NULL CHECK(direction IN ('in','out')),cash INTEGER NOT NULL CHECK(cash>=0),upi INTEGER NOT NULL CHECK(upi>=0),
      note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK(cash+upi>0));
    CREATE TABLE allocations(id INTEGER PRIMARY KEY,payment_id INTEGER NOT NULL REFERENCES payments(id),
      document_id INTEGER NOT NULL REFERENCES documents(id),amount INTEGER NOT NULL CHECK(amount>0));
    CREATE TABLE customer_returns(id INTEGER PRIMARY KEY AUTOINCREMENT,document_id INTEGER NOT NULL REFERENCES documents(id),
      total INTEGER NOT NULL CHECK(total>=0),debt_reduction INTEGER NOT NULL CHECK(debt_reduction>=0),
      refund_cash INTEGER NOT NULL CHECK(refund_cash>=0),refund_upi INTEGER NOT NULL CHECK(refund_upi>=0),reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK(total=debt_reduction+refund_cash+refund_upi));
    CREATE TABLE return_lines(id INTEGER PRIMARY KEY,return_id INTEGER NOT NULL REFERENCES customer_returns(id),
      line_id INTEGER NOT NULL REFERENCES document_lines(id),quantity INTEGER NOT NULL CHECK(quantity>0),
      saleable INTEGER NOT NULL CHECK(saleable IN (0,1)));
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE operations(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE vehicle_models(id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE);
    CREATE TABLE part_vehicles(part_id INTEGER NOT NULL REFERENCES parts(id),vehicle_id INTEGER NOT NULL REFERENCES vehicle_models(id),PRIMARY KEY(part_id,vehicle_id));
    CREATE INDEX documents_by_party ON documents(party_id);
    CREATE INDEX allocations_by_document ON allocations(document_id);
    CREATE INDEX lines_by_document ON document_lines(document_id);
    INSERT INTO schema_migrations(version) VALUES(3);`);
  for(const [key,value] of Object.entries(SHOP_PROFILE))db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run(key,value);
  const parts=db.prepare("SELECT id,vehicle FROM parts").all() as {id:number;vehicle:string}[];
  for(const part of parts)syncVehicles(db,part.id,part.vehicle);
}
export function syncVehicles(db:Database.Database,id:number,vehicles:string){
  db.prepare("DELETE FROM part_vehicles WHERE part_id=?").run(id);
  for(const name of [...new Set(vehicles.split(/[,;\n]/).map(v=>v.trim()).filter(Boolean))]){
    db.prepare("INSERT OR IGNORE INTO vehicle_models(name) VALUES(?)").run(name);
    db.prepare("INSERT OR IGNORE INTO part_vehicles(part_id,vehicle_id) SELECT ?,id FROM vehicle_models WHERE name=? COLLATE NOCASE").run(id,name);
  }
}
