import { describe, it, expect } from "vitest";
import { parseRecoveryUrl, recoveryRedirectUrl } from "../src/js/recovery.js";
import { LOGIN_PATH } from "../src/js/paths.js";

describe("recoveryRedirectUrl", () => {
  it("targets the login entry point on the given origin", () => {
    expect(recoveryRedirectUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/",
    );
    expect(recoveryRedirectUrl("https://smp-web-page.vercel.app")).toBe(
      "https://smp-web-page.vercel.app/",
    );
  });

  it("sends the recovery link to the site root, where the login page lives", () => {
    expect(LOGIN_PATH).toBe("/");
  });
});

describe("parseRecoveryUrl", () => {
  it("reports no recovery for a plain login visit", () => {
    expect(parseRecoveryUrl({ hash: "", search: "" })).toEqual({
      kind: "none",
    });
    expect(parseRecoveryUrl()).toEqual({ kind: "none" });
  });

  it("recognizes tokens in the fragment", () => {
    expect(
      parseRecoveryUrl({
        hash: "#access_token=abc.def.ghi&refresh_token=r1&expires_in=3600&token_type=bearer&type=recovery",
      }),
    ).toEqual({ kind: "tokens" });
  });

  it("ignores a fragment session that is not a recovery", () => {
    // A signup confirmation also arrives as tokens in the hash; that must fall
    // through to the normal signed-in redirect, not the password form.
    expect(parseRecoveryUrl({ hash: "#access_token=abc&type=signup" })).toEqual(
      { kind: "none" },
    );
  });

  it("recognizes a token hash in the query string", () => {
    expect(
      parseRecoveryUrl({ search: "?token_hash=pkce_abc123&type=recovery" }),
    ).toEqual({ kind: "tokenHash", tokenHash: "pkce_abc123" });
  });

  it("requires type=recovery alongside a token hash", () => {
    expect(
      parseRecoveryUrl({ search: "?token_hash=pkce_abc123&type=invite" }),
    ).toEqual({ kind: "none" });
  });

  it("reports the expired-link error the app has to explain", () => {
    // Verbatim shape of the failing link that prompted this work.
    expect(
      parseRecoveryUrl({
        hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=",
      }),
    ).toEqual({
      kind: "error",
      code: "otp_expired",
      description: "Email link is invalid or has expired",
    });
  });

  it("falls back to the error name when no error_code is present", () => {
    expect(parseRecoveryUrl({ hash: "#error=server_error" })).toEqual({
      kind: "error",
      code: "server_error",
      description: "",
    });
  });

  it("prefers an error over tokens in the same fragment", () => {
    expect(
      parseRecoveryUrl({
        hash: "#access_token=abc&type=recovery&error_code=otp_expired",
      }).kind,
    ).toBe("error");
  });
});
