import { describe, it, expect, vi } from "vitest";

// DEMO_MODE defaults on in the test env (no VITE_DEMO_MODE=false), so the
// account helpers must simulate and never touch the Supabase client.
const invoke = vi.fn();
vi.mock("../src/js/supabaseClient.js", () => ({
  supabase: { functions: { invoke } },
}));

const {
  createAccount,
  resetPassword,
  setAccountActive,
  listAccounts,
  generateTempPassword,
} = await import("../src/js/accounts.js");

describe("accounts — demo mode simulates and never calls the function", () => {
  it("createAccount returns a simulated result without invoking", async () => {
    const res = await createAccount({
      email: "a@b.com",
      password: "x",
      role: "teacher",
    });
    expect(res).toEqual({ simulated: true, email: "a@b.com" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("resetPassword and setAccountActive simulate too", async () => {
    expect(await resetPassword("a@b.com")).toEqual({ simulated: true });
    expect(await setAccountActive("uid", false)).toEqual({ simulated: true });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("listAccounts returns a simulated fixture without invoking", async () => {
    const res = await listAccounts();
    expect(res.simulated).toBe(true);
    expect(Array.isArray(res.accounts)).toBe(true);
    expect(res.accounts.length).toBeGreaterThan(0);
    // Every fixture row carries the shape the Accounts screen renders.
    for (const acc of res.accounts) {
      expect(acc).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          email: expect.any(String),
          name: expect.any(String),
          role: expect.any(String),
          banned: expect.any(Boolean),
        }),
      );
    }
    // At least one deactivated row so the reactivate flow is demonstrable.
    expect(res.accounts.some((a) => a.banned)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("generateTempPassword", () => {
  it("produces a 12-char password from the safe alphabet", () => {
    const pw = generateTempPassword();
    expect(pw).toHaveLength(12);
    expect(pw).toMatch(/^[A-Za-z0-9@#%]+$/);
    expect(generateTempPassword()).not.toBe(pw); // random
  });
});
