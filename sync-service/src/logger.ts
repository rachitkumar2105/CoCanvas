import pino from "pino";

/**
 * Structured JSON logging (Section 5/12: "pino/winston structured logs (Sync Service)")
 * so a document's activity — connections, sync errors, snapshot timing — can be traced
 * and correlated with the Core API's own logs, instead of scattered plain console lines.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "sync-service" },
});

export function docLogger(documentId: string) {
  return logger.child({ documentId });
}
