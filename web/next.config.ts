import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Share the repo-root .env with the CLIs (ANTHROPIC_API_KEY, PLAID_*).
loadEnv({ path: resolve(process.cwd(), "../.env") });

const nextConfig: NextConfig = {
  // The shared library in ../src uses ESM ".js" import specifiers that point to
  // ".ts" sources. Map them so Next's bundler resolves correctly.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
  // better-sqlite3 is a native module — keep it out of the bundle.
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: process.cwd() + "/..",
};

export default nextConfig;
