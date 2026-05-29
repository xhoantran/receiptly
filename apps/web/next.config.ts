import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Share the repo-root .env with the CLIs (ANTHROPIC_API_KEY, PLAID_*).
// apps/web now sits two levels below the repo root.
loadEnv({ path: resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {
  // The shared engine (@receiptly/core) ships untranspiled TS and uses ESM ".js"
  // import specifiers that point to ".ts" sources. Transpile it and map the
  // extensions so Next's bundler resolves correctly.
  transpilePackages: ["@receiptly/core"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
  outputFileTracingRoot: process.cwd() + "/../..",
};

export default nextConfig;
