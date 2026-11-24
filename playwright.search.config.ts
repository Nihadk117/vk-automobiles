import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const external=process.env.SHOP_SEARCH_EXTERNAL==="1";
export default defineConfig({
  testDir:"./tests/browser",testMatch:"part-search.spec.ts",workers:1,
  outputDir:`qa-artifacts/${external?"search-before":"search-after"}/evidence`,
  reporter:[["list"],["html",{outputFolder:`qa-artifacts/${external?"search-before":"search-after"}/report`,open:"never"}]],
  use:{baseURL:external?"http://127.0.0.1:3100":"http://127.0.0.1:3110",...(process.env.CI?{}:{channel:"chrome"}),trace:"retain-on-failure"},
  webServer:external?undefined:{command:`node ${process.env.SHOP_BUILD_DIR||".next"}/standalone/server.js`,url:"http://127.0.0.1:3110/api/health",reuseExistingServer:false,
    env:{PORT:"3110",HOSTNAME:"127.0.0.1",SHOP_DATABASE_PATH:resolve("data/test-runs/part-search/shop.sqlite"),NEXT_TELEMETRY_DISABLED:"1"}},
});
