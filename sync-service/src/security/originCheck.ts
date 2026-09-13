const rawAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:3000";
export const ALLOWED_ORIGINS = rawAllowedOrigins
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * An unchecked Origin on a WebSocket upgrade lets any website open a connection using a
 * victim's browser session (the browser attaches cookies/auth state, not the attacker's
 * page). A real browser always sends Origin on a WS handshake, so we can enforce an
 * allow-list against it. A *missing* Origin means the connecting client isn't a browser
 * at all (a server-to-server script, curl, our own smoke-test.mjs) — that's not the
 * attack this check defends against, so it's allowed through rather than rejected.
 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}
