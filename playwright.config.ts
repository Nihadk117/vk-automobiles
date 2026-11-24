import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const database=resolve(process.env.SHOP_TEST_DATABASE||`data/test-runs/browser-${Date.now()}/shop.sqlite`);
process.env.SHOP_TEST_DATABASE=database;
export default defineConfig({
  testDir:"./tests/browser",
  workers:1,
  timeout:90000,
  outputDir:"qa-artifacts/browser/evidence",
  reporter:[["list"],["html",{outputFolder:"qa-artifacts/browser/report",open:"never"}],["json",{outputFile:"qa-artifacts/browser/results.json"}]],
  use:{baseURL:"http://127.0.0.1:3100",...(process.env.CI?{}:{channel:"chrome"}),trace:"retain-on-failure"},
  webServer:{
    command:`node ${process.env.SHOP_BUILD_DIR||".next"}/standalone/server.js`,
    url:"http://127.0.0.1:3100/api/health",
    reuseExistingServer:false,
    env:{PORT:"3100",HOSTNAME:"127.0.0.1",SHOP_DATABASE_PATH:database,NEXT_TELEMETRY_DISABLED:"1"},
  },
});
