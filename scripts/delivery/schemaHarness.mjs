/**
 * @returns {Promise<{ ok: boolean, school: object, demo: object }>}
 */
export async function runSchemaHarness() {
  const shape = () => ({
    ok: false,
    applied: [],
    lock: { ok: false, counts: {}, tables: [], error: null },
    audit: { ok: false, check: null, sqlstate: null, error: null },
  });
  return { ok: false, school: shape(), demo: shape() };
}
