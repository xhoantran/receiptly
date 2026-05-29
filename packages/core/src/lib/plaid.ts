import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";
import { config } from "./config.js";

const plaidEnv =
  PlaidEnvironments[config.plaid.env as keyof typeof PlaidEnvironments] ??
  PlaidEnvironments.sandbox;

export const plaid = new PlaidApi(
  new Configuration({
    basePath: plaidEnv,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": config.plaid.clientId,
        "PLAID-SECRET": config.plaid.secret,
      },
    },
  })
);

export async function createLinkToken(userId: string): Promise<string> {
  const res = await plaid.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "fetch (prototype)",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  });
  return res.data.link_token;
}

export async function exchangePublicToken(publicToken: string): Promise<{
  access_token: string;
  item_id: string;
}> {
  const res = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  return { access_token: res.data.access_token, item_id: res.data.item_id };
}

export type Tx = {
  id: string;
  date: string;
  authorized_datetime: string | null;
  amount: number;
  merchant: string;
  raw_name: string;
  pending: boolean;
  account_id: string;
};

export async function syncTransactions(accessToken: string, cursor?: string) {
  const added: Tx[] = [];
  let nextCursor = cursor;
  let hasMore = true;

  while (hasMore) {
    const res = await plaid.transactionsSync({
      access_token: accessToken,
      cursor: nextCursor,
    });
    for (const t of res.data.added) {
      added.push({
        id: t.transaction_id,
        date: t.date,
        authorized_datetime: t.authorized_datetime ?? null,
        amount: t.amount,
        merchant: t.merchant_name ?? t.name,
        raw_name: t.name,
        pending: t.pending,
        account_id: t.account_id,
      });
    }
    nextCursor = res.data.next_cursor;
    hasMore = res.data.has_more;
  }

  return { added, cursor: nextCursor };
}
