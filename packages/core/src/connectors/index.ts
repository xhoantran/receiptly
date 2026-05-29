import type { Connector, Tx } from "./types.js";
import { publixConnector } from "./publix.js";
import { amazonConnector } from "./amazon.js";
import { starbucksConnector } from "./starbucks.js";
import { costcoConnector } from "./costco.js";

export const connectors: Connector[] = [
  publixConnector,
  amazonConnector,
  starbucksConnector,
  costcoConnector,
];

export const connectorsByKey: Record<string, Connector> = Object.fromEntries(
  connectors.map((c) => [c.key, c])
);

export function findConnector(tx: Tx): Connector | null {
  return connectors.find((c) => c.matches(tx)) ?? null;
}

export type { Connector };
