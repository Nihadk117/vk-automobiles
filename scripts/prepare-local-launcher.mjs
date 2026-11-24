import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {prepareLauncher} from "./windows-launcher.mjs";
const version=JSON.parse(readFileSync("package.json","utf8")).version;
const path=prepareLauncher(resolve("release/Local launcher"),{version,runtimePath:process.execPath,
  serverPath:resolve(".next/standalone/server.js"),databasePath:resolve("data/shop.sqlite")});
console.log(path);
