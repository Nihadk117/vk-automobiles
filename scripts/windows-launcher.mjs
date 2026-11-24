import {copyFileSync,existsSync,mkdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";

export function prepareLauncher(destination,{version,runtimePath="runtime/node.exe",serverPath="app/server.js",databasePath=null,port=3000}) {
  if(process.platform!=="win32")throw new Error("Build the launcher on Windows.");
  mkdirSync(destination,{recursive:true});
  const compiler=join(process.env.SystemRoot||"C:/Windows","Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  if(!existsSync(compiler))throw new Error("The Windows .NET Framework C# compiler is required to build the desktop launcher.");
  const executable=join(destination,"VK Automobiles.exe");
  const result=spawnSync(compiler,["/nologo","/target:winexe",`/out:${executable}`,"/reference:System.Windows.Forms.dll",resolve("scripts/windows/ShopLauncher.cs")],{encoding:"utf8",windowsHide:true});
  if(result.status!==0)throw new Error(`Launcher compilation failed: ${result.stdout||result.stderr||result.error}`);
  for(const name of ["Shop.ps1","start-background.mjs"])copyFileSync(resolve("scripts/windows",name),join(destination,name));
  for(const action of ["Stop","Restart","Status"])writeFileSync(join(destination,`${action} shop.cmd`),`@echo off\r\nstart "" "%~dp0VK Automobiles.exe" --${action.toLowerCase()}\r\n`);
  writeFileSync(join(destination,"launcher.json"),JSON.stringify({version,runtimePath,serverPath,databasePath,port},null,2));
  return executable;
}
