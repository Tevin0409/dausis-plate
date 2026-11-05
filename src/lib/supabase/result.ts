/**
 * Unwraps a Supabase result for a page read. A failed query throws so the route's
 * error.tsx shows a retryable error, instead of the page rendering as if there
 * were simply nothing there. `what` names the data for the server log.
 */
type DbResult<T> = { data: T; error: null } | { data: null; error: { message: string; code?: string } };

export function must<T>(result: DbResult<T>, what: string): T {
  if (result.error !== null) {
    console.error(`[db] loading ${what} failed:`, result.error.code ?? "", result.error.message);
    throw new Error(`Couldn't load ${what}`);
  }
  return result.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a well-formed id. Malformed ids are "not found", not a database error. */
export const isUuid = (s: string) => UUID.test(s);
