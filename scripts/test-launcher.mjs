import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync,statSync} from "node:fs";
import {resolve,join,dirname} from "node:path";
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import assert from "node:assert/strict";
import {prepareLauncher} from "./windows-launcher.mjs";

if(process.platform!=="win32")throw new Error("Run launcher integration tests on Windows.");
mkdirSync(resolve("qa-artifacts"),{recursive:true});
const root=mkdtempSync(resolve("qa-artifacts/launcher-"));
const app=join(root,"Shop app & tools"),data=join(root,"Shop data & records","shop.sqlite");
const version=JSON.parse(readFileSync("package.json","utf8")).version;
const build=process.env.SHOP_BUILD_DIR||".next";
const config={version,runtimePath:process.execPath,serverPath:resolve(build,"standalone/server.js"),databasePath:data,port:3140};
const base="http://127.0.0.1:3140",statePath=join(dirname(data),"launcher/instance.json");
const results=[];
const readState=()=>JSON.parse(readFileSync(statePath,"utf8"));
const psQuote=value=>"'"+value.replaceAll("'","''")+"'";
function run(file,args,env={}){return new Promise((resolveResult,reject)=>{
  const child=spawn(file,args,{env:{...process.env,SHOP_DATABASE_PATH:"",...env},windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let out="",error="";child.stdout.on("data",d=>out+=d);child.stderr.on("data",d=>error+=d);
  const timer=setTimeout(()=>{child.kill();reject(new Error("Launcher command exceeded its timeout"));},90000);
  child.once("error",e=>{clearTimeout(timer);reject(e);});child.once("exit",code=>{clearTimeout(timer);resolveResult({code,out,error});});
});}
const launch=(folder=app,args=[])=>run(join(folder,"VK Automobiles.exe"),[...args,"--quiet","--no-browser"]);
async function check(name,fn){await fn();results.push({name,passed:true});console.log(`PASS: ${name}`);}
let cookie="";
async function api(path,body){const r=await fetch(base+path,{...(body?{method:"POST",body:JSON.stringify(body)}:{}),headers:{Origin:base,"Content-Type":"application/json",Cookie:cookie}});const result=await r.json();assert(r.ok,JSON.stringify(result));return {r,result};}
function clone(name,overrides={}){
  const folder=join(root,name);mkdirSync(folder,{recursive:true});
  for(const file of ["VK Automobiles.exe","Shop.ps1","start-background.mjs"])copyFileSync(join(app,file),join(folder,file));
  writeFileSync(join(folder,"launcher.json"),JSON.stringify({...config,...overrides}));return folder;
}
prepareLauncher(app,config);
try {
  await check("GUI launcher has no console subsystem",async()=>{
    const exe=readFileSync(join(app,"VK Automobiles.exe")),pe=exe.readUInt32LE(0x3c);assert.equal(exe.readUInt16LE(pe+24+68),2);
  });
  await check("Starts quietly with spaces and ampersands in paths; survives launcher exit",async()=>{
    assert.equal((await launch()).code,0);const h=await(await fetch(base+"/api/health")).json();assert.equal(h.instance,readState().instance);assert.equal(h.version,version);assert(existsSync(data));
    assert(readFileSync(join(dirname(statePath),"backend-output.log"),"utf8").includes("Ready"));
  });
  await check("Repeated simultaneous clicks reuse a single backend",async()=>{
    const before=readState().pid;for(const r of await Promise.all([launch(),launch(),launch()]))assert.equal(r.code,0);assert.equal(readState().pid,before);
  });
  await check("Browser opening is requested only after the backend is ready",async()=>{
    const marker=join(root,"browser-opened.json");
    const command=`& { function Start-Process { param([string]$FilePath) $h=Invoke-RestMethod '${base}/api/health'; [IO.File]::WriteAllText(${psQuote(marker)}, (@{url=$FilePath;ready=$h.status} | ConvertTo-Json)) }; & ${psQuote(join(app,"Shop.ps1"))} -Quiet }`;
    assert.equal((await run("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",command])).code,0);
    assert.deepEqual(JSON.parse(readFileSync(marker,"utf8")),{url:base+"/shop/home",ready:"ok"});
  });
  const owner=await api("/api/auth",{action:"setup",data:{username:"launcher-owner",password:"Fictional-launcher-password-123"}});cookie=owner.r.headers.get("set-cookie").split(";")[0];
  await api("/api/parts",{name:"Launcher persistence check",rack:"L-01",openingQuantity:7,sellingPricePaise:28000});
  await check("A different installed version cannot reuse the wrong running copy",async()=>{
    const before=readState().pid;const other=clone("Other version");assert.equal((await launch(other)).code,1);assert.equal(readState().pid,before);assert.equal((await fetch(base+"/api/health")).status,200);
  });
  await check("Stop, restart and fresh start preserve SQLite records and login",async()=>{
    const before=readState().pid;assert.equal((await launch(app,["--restart"])).code,0);assert.notEqual(readState().pid,before);
    assert.equal((await api("/api/parts")).result.parts[0].quantity,7);
    assert.equal((await launch(app,["--stop"])).code,0);await assert.rejects(fetch(base+"/api/health"));assert.equal((await launch()).code,0);
    assert.equal((await api("/api/parts")).result.parts[0].name,"Launcher persistence check");
  });
  await check("Oversized logs rotate on backend start",async()=>{
    assert.equal((await launch(app,["--stop"])).code,0);const log=join(dirname(statePath),"backend-output.log");writeFileSync(log,"x".repeat(2*1024*1024+10));
    assert.equal((await launch()).code,0);assert(statSync(log+".previous").size>2*1024*1024);assert(statSync(log).size<2*1024*1024);
  });
  await check("Stale or recycled process IDs never stop an unrelated process",async()=>{
    const old=readState();assert.equal((await launch(app,["--stop"])).code,0);writeFileSync(statePath,JSON.stringify({...old,pid:process.pid,startedTicks:"0"}));
    assert.equal((await launch(app,["--stop"])).code,0);assert(process.kill(process.pid,0));
    writeFileSync(statePath,JSON.stringify({...old,pid:process.pid,startedTicks:"0"}));assert.equal((await launch()).code,0);assert(process.kill(process.pid,0));
  });
  await check("Foreign occupied port produces a safe failure without stopping its owner",async()=>{
    const foreign=createServer((_,r)=>r.end("foreign application"));await new Promise(r=>foreign.listen(3141,"127.0.0.1",r));
    try{const other=clone("Occupied port",{port:3141,databasePath:join(root,"foreign-data/shop.sqlite")});assert.equal((await launch(other)).code,1);assert.equal(await(await fetch("http://127.0.0.1:3141")).text(),"foreign application");}finally{await new Promise(r=>foreign.close(r));}
  });
  await check("Different database files in one folder keep independent launcher state",async()=>{
    const originalPid=readState().pid;
    const other=clone("Second database",{port:3145,databasePath:join(dirname(data),"second-shop.sqlite")});
    try{assert.equal((await launch(other)).code,0);assert.equal((await fetch("http://127.0.0.1:3145/api/health")).status,200);assert.equal(readState().pid,originalPid);}
    finally{assert.equal((await launch(other,["--stop"])).code,0);}
    assert.equal((await api("/api/parts")).result.parts[0].quantity,7);
  });
  await check("Unicode install and database paths survive repeated starts without creating a second database",async()=>{
    const name="Shop "+String.fromCodePoint(0x0d15,0x0d47,0x0d30,0x0d33,0x0d02),unicodeData=join(root,name,"data/shop.sqlite");
    const other=clone(name,{port:3146,databasePath:unicodeData});
    try{assert.equal((await launch(other)).code,0);assert(existsSync(unicodeData));const first=JSON.parse(readFileSync(join(dirname(unicodeData),"launcher/instance.json"),"utf8"));assert.equal((await launch(other)).code,0);const second=JSON.parse(readFileSync(join(dirname(unicodeData),"launcher/instance.json"),"utf8"));assert.equal(first.pid,second.pid);}
    finally{assert.equal((await launch(other,["--stop"])).code,0);}
  });
  await check("An unavailable backup folder does not crash startup or block authenticated stock reads",async()=>{
    const folder=join(root,"Blocked backup"),databasePath=join(folder,"shop.sqlite");mkdirSync(folder,{recursive:true});writeFileSync(join(folder,"backups"),"Fault injection");
    const other=clone("Backup startup",{port:3147,databasePath}),url="http://127.0.0.1:3147";
    try{
      assert.equal((await launch(other)).code,0);assert.equal((await(await fetch(url+"/api/health")).json()).status,"ok");
      const auth=await fetch(url+"/api/auth",{method:"POST",headers:{Origin:url,"Content-Type":"application/json"},body:JSON.stringify({action:"setup",data:{username:"backup-owner",password:"Fictional-backup-password-123"}})});assert.equal(auth.status,200);
      const headers={Cookie:auth.headers.get("set-cookie").split(";")[0]};const copies=await fetch(url+"/api/backups",{headers});assert.equal(copies.status,200);assert((await copies.json()).error);assert.equal((await fetch(url+"/api/parts",{headers})).status,200);
    }finally{assert.equal((await launch(other,["--stop"])).code,0);}
  });
  await check("Missing application files fail clearly",async()=>{
    const other=clone("Missing files",{port:3142,databasePath:join(root,"missing-data/shop.sqlite"),serverPath:join(root,"missing-server.js")});assert.equal((await launch(other)).code,1);
    assert(readFileSync(join(root,"missing-data/launcher/launcher.log"),"utf8").includes("files are missing"));
  });
  await check("Failed backend startup is reported and does not open a browser",async()=>{
    const stub=join(root,"failed-server.cjs");writeFileSync(stub,"process.exit(2)");
    const other=clone("Failed backend",{port:3143,databasePath:join(root,"failed-data/shop.sqlite"),serverPath:stub});assert.equal((await launch(other)).code,1);
    assert(readFileSync(join(root,"failed-data/launcher/launcher.log"),"utf8").includes("startup"));
  });
  await check("Unready backend times out and its verified process is stopped",async()=>{
    const stub=join(root,"unready-server.cjs");writeFileSync(stub,"require('node:http').createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({status:'unavailable'}))}).listen(process.env.PORT,'127.0.0.1')");
    const other=clone("Unready backend",{port:3144,databasePath:join(root,"unready-data/shop.sqlite"),serverPath:stub});
    const r=await run("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",join(other,"Shop.ps1"),"-NoBrowser","-Quiet","-StartupTimeoutSeconds","5"]);assert.equal(r.code,1);
    assert(readFileSync(join(root,"unready-data/launcher/launcher.log"),"utf8").includes("too long"));await assert.rejects(fetch("http://127.0.0.1:3144/api/health"));
  });
  await check("Installer creates a GUI desktop shortcut and separate maintenance controls",async()=>{
    const installer=join(root,"Installer fixture");mkdirSync(installer,{recursive:true});
    const {cpSync}=await import("node:fs");cpSync(app,join(installer,"App"),{recursive:true});copyFileSync(resolve("scripts/windows/Install.ps1"),join(installer,"Install.ps1"));
    const installRoot=join(root,"Installed apps"),desktop=join(root,"Test desktop");
    const r=await run("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",join(installer,"Install.ps1"),"-InstallRoot",installRoot,"-DesktopDirectory",desktop]);assert.equal(r.code,0,r.error);
    const shortcut=join(desktop,"VK Automobiles.lnk");assert(existsSync(shortcut));
    const target=join(installRoot,"Installer fixture","VK Automobiles.exe");
    const read=await run("powershell.exe",["-NoProfile","-Command",`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(shortcut)}); Write-Output $s.TargetPath`]);assert.equal(read.out.trim(),target);
    for(const action of ["Stop","Restart","Status"])assert(existsSync(join(installRoot,"Installer fixture/Maintenance",action+" shop.lnk")));
    assert.equal((await api("/api/parts")).result.parts[0].quantity,7);
  });
} catch(error) {console.error(error);process.exitCode=1;results.push({passed:false,error:error.message});}
finally {
  await launch(app,["--stop"]).catch(()=>{});
  writeFileSync(join(root,"results.json"),JSON.stringify({version,results},null,2));console.log(`Evidence: ${root}`);
}
