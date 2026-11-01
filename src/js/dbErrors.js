/** @typedef {import("./validate.js").Message} Message */

/**
 * Postgres SQLSTATEs a console write can realistically provoke. Anything else
 * is a bug rather than a user mistake, and falls back to the generic message.
 * @type {Record<string, string>}
 */
const CODE_KEYS = {
  22001: "errors.db.tooLong", // value longer than the column allows
  23502: "errors.db.missingRequired", // not-null violation
  23503: "errors.db.stillReferenced", // FK — the row is still in use
  23505: "errors.db.duplicate", // unique violation
  23514: "errors.db.notAllowedValue", // check constraint
  42501: "errors.db.notPermitted", // RLS / insufficient privilege
};

/**
 * @param {any} err
 * @returns {Message} always resolvable — unknown failures get the generic key
 *   explicitly, because t() humanizes an unrecognised key instead of failing,
 *   which would render an invented string to the user.
 */
export function mapDbError(err) {
  const key = CODE_KEYS[String(err?.code ?? "")];
  return { key: key ?? "errors.db.generic" };
}

/**
 * True when the failure is one we can explain in the user's own terms. Callers
 * that want to log the raw error only when it is *not* understood can branch on
 * this; `mapDbError` itself always returns something displayable.
 * @param {any} err
 */
export function isKnownDbError(err) {
  return Object.hasOwn(CODE_KEYS, String(err?.code ?? ""));
}
