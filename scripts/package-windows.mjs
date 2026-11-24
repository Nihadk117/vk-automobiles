import {cpSync,copyFileSync,existsSync,mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {spawnSync} from "node:child_process";
import {prepareLauncher} from "./windows-launcher.mjs";
if(process.platform!=="win32")throw new Error("Build the Windows package on Windows so the SQLite binary matches.");
const source=resolve(".next/standalone");
if(!existsSync(join(source,"server.js")))throw new Error("Run npm run build before packaging.");
if(existsSync(join(source,"data")))throw new Error("Build output contains data. Refusing to package shop records.");
const version=JSON.parse(readFileSync("package.json","utf8")).version;
const label=`VK-Automobiles-${version}-win-${process.arch}-${Date.now()}`;
const destination=resolve("release",label),app=join(destination,"App");
mkdirSync(join(app,"runtime"),{recursive:true});
cpSync(source,join(app,"app"),{recursive:true,dereference:true,filter:path=>!/[\\/](data|\.git)([\\/]|$)/.test(path)&&!/[\\/]\.env[^\\/]*$/.test(path)});
copyFileSync(process.execPath,join(app,"runtime","node.exe"));
prepareLauncher(app,{version});
writeFileSync(join(app,"Launch.cmd"),'@echo off\r\nstart "" "%~dp0VK Automobiles.exe"\r\n');
for(const action of ["Stop","Restart","Status"])writeFileSync(join(app,`${action} shop.cmd`),`@echo off\r\nstart "" "%~dp0VK Automobiles.exe" --${action.toLowerCase()}\r\n`);
writeFileSync(join(destination,"Install.cmd"),'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1"\r\npause\r\n');
copyFileSync(resolve("scripts/windows/Install.ps1"),join(destination,"Install.ps1"));
writeFileSync(join(destination,"README.txt"),`VK AutoMobiles - Spare Parts (${version})

Extract the ZIP fully and double-click Install.cmd. A VK Automobiles desktop shortcut is created for this Windows user. It starts the backend quietly, waits until ready and opens the default browser. No separate Node/npm installation is needed. Alternatively double-click App/VK Automobiles.exe from the extracted package.

After restarting Windows, double-click the shortcut again. Closing the browser leaves the backend running. Repeated shortcut clicks reuse the verified running instance. No Windows automatic-start task or service is installed. Keep using the same Windows user account.

First launch: create your owner username and password (at least 12 characters) and save the recovery code privately. Use Accounts & access to create staff. Login and billing work offline. Lock / sign out ends the login session; it does not stop the backend.

Maintenance: the installed application folder contains a Maintenance folder with Stop, Restart and Status shortcuts. Portable copies include matching CMD helpers. Save work and download a backup before stopping or updating. Stop interrupts in-flight requests; if a save was interrupted, inspect bill history before retrying. Stopping closes the backend; it does not sign out persisted login sessions. Use Lock / sign out before handing the computer to another person.

For updates: download a backup, use Stop shop, run the new Install.cmd, then open the new desktop shortcut. A running older version is not silently replaced. If port 3000 belongs to a manual shop console or another application, the launcher shows an error and never stops or reuses the unverified process.

Records: %LOCALAPPDATA%/VKAutomobiles/data/shop.sqlite. Application versions are stored separately. This ZIP contains no shop records or default credentials. To transfer real records, create the owner account in the destination installation, then restore an app-generated backup. Restoration preserves the destination accounts and revokes sessions. Backups contain confidential business information and password hashes; keep them private.

Diagnostics: %LOCALAPPDATA%/VKAutomobiles/data/launcher contains launcher.log, backend-output.log, backend-error.log and instance.json. Logs rotate on backend start when larger than 2 MB, retaining one previous copy of each. Do not manually delete SQLite or journal files. A startup failure shows a message rather than opening an unavailable page.

This is a single-computer application bound to 127.0.0.1. Verify installation and A4 printing on the actual shop computer and complete the paper-parallel pilot before daily use.

Bundled Node: ${process.version}; Windows/${process.arch}. The GUI launcher uses Windows PowerShell 5.1 and .NET Framework 4.x. Rebuild for another platform/architecture.
`);
const zip=destination+".zip";
const result=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command","Compress-Archive -LiteralPath $env:VK_PACKAGE_SOURCE -DestinationPath $env:VK_PACKAGE_ZIP -CompressionLevel Fastest"],{stdio:"inherit",windowsHide:true,env:{...process.env,VK_PACKAGE_SOURCE:destination,VK_PACKAGE_ZIP:zip}});
if(result.status!==0)throw new Error("ZIP creation failed. The extracted package is still available.");
console.log(JSON.stringify({directory:destination,zip,bundledNode:process.version},null,2));
