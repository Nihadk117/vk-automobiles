import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const run=process.env.SHOP_QA_RUN||"watched";
const directory=`qa-artifacts/${run}`;
export default defineConfig({
  testDir:"./tests/acceptance",workers:1,timeout:180_000,expect:{timeout:10_000},
  outputDir:`${directory}/evidence`,
  reporter:[["list",{printSteps:true}],["html",{outputFolder:`${directory}/report`,open:"never"}],["json",{outputFile:`${directory}/results.json`}]],
  use:{baseURL:"http://127.0.0.1:3100",...(process.env.CI?{}:{channel:"chrome"}),headless:process.env.SHOP_QA_HEADLESS==="1",
    launchOptions:{slowMo:Number(process.env.SHOP_QA_SLOW_MS||250)},viewport:{width:1440,height:960},
    video:"on",trace:"on",screenshot:"only-on-failure"},
  webServer:{command:`node ${process.env.SHOP_BUILD_DIR||".next"}/standalone/server.js`,
    url:"http://127.0.0.1:3100/api/health",reuseExistingServer:false,
    env:{PORT:"3100",HOSTNAME:"127.0.0.1",SHOP_DATABASE_PATH:resolve(`data/test-runs/${run}-${Date.now()}.sqlite`),NEXT_TELEMETRY_DISABLED:"1"}},
});
