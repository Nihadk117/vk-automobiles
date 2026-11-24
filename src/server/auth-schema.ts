import type Database from "better-sqlite3";
export function initialiseAuth(db:Database.Database){
  if(db.prepare("SELECT version FROM schema_migrations WHERE version=4").get())return;
  db.exec(`CREATE TABLE auth_users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL CHECK(role IN ('owner','staff')),password_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)));
    CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES auth_users(id),created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
    CREATE TABLE auth_failures(bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window_start INTEGER NOT NULL);
    CREATE TABLE auth_config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE auth_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id INTEGER,actor_name TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO schema_migrations(version) VALUES(4);`);
}
