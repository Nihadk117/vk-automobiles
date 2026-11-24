import {defineConfig} from "@playwright/test";
import {resolve} from "node:path";
export default defineConfig({testDir:"./tests/auth-browser",workers:1,timeout:90000,
  outputDir:"qa-artifacts/auth/evidence",reporter:[["list"],["html",{outputFolder:"qa-artifacts/auth/report",open:"never"}],["json",{outputFile:"qa-artifacts/auth/results.json"}]],
  use:{baseURL:"http://127.0.0.1:3120",...(process.env.CI?{}:{channel:"chrome"}),trace:"retain-on-failure",screenshot:"only-on-failure"},
  webServer:{command:`node ${process.env.SHOP_BUILD_DIR||".next"}/standalone/server.js`,url:"http://127.0.0.1:3120/api/health",reuseExistingServer:false,
    env:{PORT:"3120",HOSTNAME:"127.0.0.1",SHOP_DATABASE_PATH:resolve(`data/test-runs/auth-${Date.now()}/shop.sqlite`),NEXT_TELEMETRY_DISABLED:"1"}},
});
