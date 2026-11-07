import { describe, it, expect } from "vitest";
import { mapDbError, isKnownDbError } from "../src/js/dbErrors.js";

/** Shape PostgREST actually returns for a failed write. */
const pgError = (code, message) => ({ code, message, details: null });

describe("mapDbError", () => {
  it("maps the constraint violations a console write can provoke", () => {
    expect(mapDbError(pgError("22001")).key).toBe("errors.db.tooLong");
    expect(mapDbError(pgError("22023")).key).toBe("errors.db.notAllowedValue");
    expect(mapDbError(pgError("23502")).key).toBe("errors.db.missingRequired");
    expect(mapDbError(pgError("23503")).key).toBe("errors.db.stillReferenced");
    expect(mapDbError(pgError("23505")).key).toBe("errors.db.duplicate");
    expect(mapDbError(pgError("23514")).key).toBe("errors.db.notAllowedValue");
    expect(mapDbError(pgError("42501")).key).toBe("errors.db.notPermitted");
  });

  it("falls back to an explicit generic key, never a synthesized one", () => {
    // t() humanizes an unknown key instead of failing, so an invented key would
    // be rendered to the user verbatim. Every path must land on a real key.
    expect(mapDbError(pgError("XX000")).key).toBe("errors.db.generic");
    expect(mapDbError(new TypeError("boom")).key).toBe("errors.db.generic");
    expect(mapDbError(undefined).key).toBe("errors.db.generic");
    expect(mapDbError(null).key).toBe("errors.db.generic");
  });

  it("never leaks the raw database message", () => {
    const raw =
      'update or delete on table "teachers" violates foreign key constraint ' +
      '"class_subject_teachers_teacher_id_fkey" on table "class_subject_teachers"';
    const mapped = mapDbError(pgError("23503", raw));
    expect(mapped.key).toBe("errors.db.stillReferenced");
    expect(JSON.stringify(mapped)).not.toContain("fkey");
  });
});

describe("isKnownDbError", () => {
  it("distinguishes a user mistake from a bug worth investigating", () => {
    expect(isKnownDbError(pgError("23505"))).toBe(true);
    expect(isKnownDbError(pgError("XX000"))).toBe(false);
    expect(isKnownDbError(new Error("network"))).toBe(false);
  });
});
