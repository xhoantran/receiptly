// Loads the repo-root .env for CLI / server entrypoints.
//
// The web app loads it via next.config; the CLI runs with cwd=packages/core, so
// `import "dotenv/config"` (which reads cwd/.env) misses it. We resolve the repo
// root explicitly. dotenv does NOT override already-set process.env vars, so
// layering these candidates is safe — the first definition wins.
//
// Import this FIRST in any entrypoint, before modules that read env at load time
// (lib/config.ts validates PLAID_*, db/index.ts requires DATABASE_URL).
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // packages/core/src/lib
loadEnv({ path: resolve(here, "../../../../.env") }); // monorepo repo root
loadEnv(); // and a .env in the current working directory, if present
