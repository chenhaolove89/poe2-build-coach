/**
 * The share store's contract, so the database is a swappable part.
 *
 * The share server should run on the same database the host already runs for its
 * other services (统一接入), and which one that is lives on the server, not in
 * this repo. So the API routes talk to this interface and `drivers/` holds the
 * implementations; picking one is an env var, adding one is a file:
 *
 *   - implement `ShareStore` (the shape is three calls, all trivial SQL)
 *   - register it in `lib/db.ts`
 *   - set SHARE_DB=<name> for the process
 *
 * The contract is async because remote databases are; the sqlite driver just
 * resolves synchronously underneath.
 */
export interface ShareRow {
  id: string
  code: string
  /** JSON-encoded display summary, or null when the uploader sent none. */
  summary: string | null
  created_at: number
  expires_at: number
}

export interface ShareStore {
  insert(id: string, code: string, summary: string | null, now: number): Promise<void>
  get(id: string): Promise<ShareRow | undefined>
  /**
   * Sliding expiry: a link people still open stays alive. Returns the new expiry;
   * a failed refresh must not fail the read, so drivers swallow their own errors
   * here and degrade to "no change".
   */
  touch(id: string, now: number): Promise<number>
}
