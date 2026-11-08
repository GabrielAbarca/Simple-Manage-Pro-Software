/**
 * Guards against a build talking to the wrong Supabase project.
 *
 * The demo and every school run the same code against different projects,
 * chosen entirely by `VITE_SUPABASE_URL` at build time. Demo mode blocks
 * writes but reads pass straight through to whatever project is configured,
 * so a demo build pointed at a school project would render that school's real
 * student records to anyone who opened the public demo — no bug required,
 * just one wrong environment variable on one deployment.
 *
 * Setting `VITE_EXPECTED_PROJECT_REF` on a deployment turns that silent
 * mistake into a refusal to start. It is optional: unset (dev, CI, tests) the
 * check does nothing.
 */

/**
 * The project ref embedded in a Supabase URL — the first hostname label of
 * `https://<ref>.supabase.co`. Returns null for anything unparseable, since a
 * malformed URL is the client's problem to report, not this module's.
 */
export function refFromUrl(url: string): string | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  try {
    const { hostname } = new URL(url);
    const [ref] = hostname.split(".");
    return ref || null;
  } catch {
    return null;
  }
}

/**
 * Throws when the configured URL points somewhere other than the expected
 * project. No-op when `expectedRef` is empty, which is the default everywhere
 * except a deployment that opts in.
 *
 * @param url the configured VITE_SUPABASE_URL
 * @param expectedRef the configured VITE_EXPECTED_PROJECT_REF
 */
export function assertExpectedRef(
  url: string,
  expectedRef: string | undefined,
): void {
  const expected = typeof expectedRef === "string" ? expectedRef.trim() : "";
  if (!expected) return;

  const actual = refFromUrl(url);
  if (actual === expected) return;

  throw new Error(
    `Supabase project mismatch: this build expects project "${expected}" but ` +
      `VITE_SUPABASE_URL points at "${actual ?? "an unreadable URL"}". ` +
      `Refusing to start rather than risk showing one project's data in ` +
      `another's deployment. Fix VITE_SUPABASE_URL, or update ` +
      `VITE_EXPECTED_PROJECT_REF if this deployment really did move.`,
  );
}
