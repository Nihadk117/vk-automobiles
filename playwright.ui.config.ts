import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir:"./tests/ui",workers:1,timeout:120000,
  outputDir:"qa-artifacts/ui-polish/evidence",
  reporter:[["list"],["html",{outputFolder:"qa-artifacts/ui-polish/report",open:"never"}],["json",{outputFile:"qa-artifacts/ui-polish/results.json"}]],
  use:{baseURL:"http://127.0.0.1:3110",...(process.env.CI?{}:{channel:"chrome"}),viewport:{width:1440,height:960},trace:"retain-on-failure",screenshot:"only-on-failure"},
  webServer:{command:`node ${process.env.SHOP_BUILD_DIR||".next"}/standalone/server.js`,url:"http://127.0.0.1:3110/api/health",reuseExistingServer:false,
    env:{PORT:"3110",HOSTNAME:"127.0.0.1",SHOP_DATABASE_PATH:resolve(`data/test-runs/ui-review-${Date.now()}/shop.sqlite`),NEXT_TELEMETRY_DISABLED:"1"}},
});
