import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.SHOP_BUILD_DIR || ".next",
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  async headers(){return [{source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Referrer-Policy",value:"same-origin"}]}];},
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./test-results/**/*", "./qa-artifacts/**/*", "./release/**/*", "./.env*"],
  },
};

export default nextConfig;
