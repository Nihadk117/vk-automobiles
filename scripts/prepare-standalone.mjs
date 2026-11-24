import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const root = process.cwd();
const build=process.env.SHOP_BUILD_DIR||".next";
cpSync(resolve(root,build,"static"),resolve(root,build,"standalone",build,"static"),{recursive:true});
if(existsSync(resolve(root,"public"))) cpSync(resolve(root,"public"),resolve(root,build,"standalone/public"),{recursive:true});
console.log("Standalone server assets prepared.");
