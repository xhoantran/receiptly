import type { Connector, Tx } from "./types.js";
import { publixConnector } from "./publix.js";
import { amazonConnector } from "./amazon.js";
import { costcoConnector } from "./costco.js";
import { wholefoodsConnector } from "./wholefoods.js";

// Only merchants with a working capture path are registered as connectors (they
// show as connectable on the Merchants page). Everything else lives in the
// catalog (apps/web/lib/merchants.ts) as "soon" and appears in the roadmap grid.
export const connectors: Connector[] = [
  publixConnector,
  amazonConnector,
  costcoConnector,
  wholefoodsConnector,
];

export const connectorsByKey: Record<string, Connector> = Object.fromEntries(
  connectors.map((c) => [c.key, c])
);

export function findConnector(tx: Tx): Connector | null {
  return connectors.find((c) => c.matches(tx)) ?? null;
}

export type { Connector };
