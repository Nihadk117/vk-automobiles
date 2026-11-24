import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
const server=resolve(".next/standalone/server.js");
if(!existsSync(server))throw new Error("Build the application with npm run build first.");
const child=spawn(process.execPath,[server],{stdio:"inherit",env:{...process.env,
  HOSTNAME:"127.0.0.1",PORT:process.env.PORT||"3000",NEXT_TELEMETRY_DISABLED:"1",
  SHOP_DATABASE_PATH:resolve(process.env.SHOP_DATABASE_PATH||"data/shop.sqlite")}});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
child.on("error",error=>{console.error(error.message);process.exitCode=1;});
child.on("exit",code=>{process.exitCode=code??0;});
