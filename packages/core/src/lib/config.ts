import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const config = {
  plaid: {
    clientId: required("PLAID_CLIENT_ID"),
    secret: required("PLAID_SECRET"),
    env: process.env.PLAID_ENV ?? "development",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  },
  port: Number(process.env.PORT ?? 3000),
};
