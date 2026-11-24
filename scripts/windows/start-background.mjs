import {readFileSync,openSync,closeSync} from "node:fs";
import {spawn} from "node:child_process";
import {dirname} from "node:path";

// Give the detached backend real file handles, not pipes owned by the launcher.
// Logging continues after the launcher and its PowerShell process have exited.
const spec=JSON.parse(readFileSync(process.argv[2],"utf8"));
const output=openSync(spec.stdout,"a"),errors=openSync(spec.stderr,"a");
try {
  const child=spawn(process.execPath,[spec.serverPath],{
    cwd:dirname(spec.serverPath),detached:true,windowsHide:true,
    stdio:["ignore",output,errors],
    env:{...process.env,HOSTNAME:"127.0.0.1",PORT:String(spec.port),SHOP_DATABASE_PATH:spec.databasePath,
      SHOP_LAUNCHER_INSTANCE:spec.instance,NEXT_TELEMETRY_DISABLED:"1"},
  });
  await new Promise((resolve,reject)=>{child.once("spawn",resolve);child.once("error",reject);});
  child.unref();process.stdout.write(JSON.stringify({pid:child.pid}));
} finally {closeSync(output);closeSync(errors);}
