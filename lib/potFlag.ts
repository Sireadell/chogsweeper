// The Daily Pot is off unless POT_ENABLED is exactly "true". Any future pot route or page must
// call potEnabled() first and answer as if it does not exist (404) when it is off.
export function potEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.POT_ENABLED === "true";
}

// For a route handler: returns a plain 404 when the pot is off, or null to carry on.
export function potGate(env: Record<string, string | undefined> = process.env): Response | null {
  return potEnabled(env) ? null : new Response("Not found", { status: 404 });
}
