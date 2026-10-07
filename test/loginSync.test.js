import { describe, it, expect, vi, beforeEach } from "vitest";

const accounts = vi.hoisted(() => ({
  setAccountActive: vi.fn(),
  listAccounts: vi.fn(),
}));
const feedback = vi.hoisted(() => ({
  showToast: vi.fn(),
  openNotice: vi.fn(),
  openConfirm: vi.fn(),
}));
const adminState = vi.hoisted(() => ({
  state: { session: { user: { id: "me" } } },
}));

vi.mock("../src/js/accounts.js", () => ({
  ...accounts,
  createAccount: vi.fn(),
  resetPassword: vi.fn(),
  generateTempPassword: vi.fn(),
}));
vi.mock("../src/js/i18n.js", () => ({ t: (key) => key }));
vi.mock("../src/js/admin/ui/feedback.js", () => feedback);
vi.mock("../src/js/admin/state.js", () => adminState);
vi.mock("../src/js/admin/data.js", () => ({ data: {} }));
vi.mock("../src/js/admin/ui/tables.js", () => ({ iconBtn: vi.fn() }));
vi.mock("../src/js/admin/ui/modal.js", () => ({ openModal: vi.fn() }));

const { syncLoginWithStatus } =
  await import("../src/js/admin/domain/accountActions.js");

const ana = { id: 1, status: "active", auth_user_id: "ana" };
const toasts = () => feedback.showToast.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of [...Object.values(accounts), ...Object.values(feedback)])
    fn.mockReset();
  accounts.setAccountActive.mockResolvedValue({});
  accounts.listAccounts.mockResolvedValue({
    accounts: [
      { id: "ana", role: "student" },
      { id: "dir", role: "admin" },
    ],
  });
});

describe("syncLoginWithStatus", () => {
  it("deactivates the login when a student leaves Active", async () => {
    await syncLoginWithStatus(ana, "student", "withdrawn");
    expect(accounts.setAccountActive).toHaveBeenCalledWith("ana", false);
    expect(toasts()).toEqual(["console.accounts.loginDisabledWithStatus"]);
  });

  it("restores the login when a student comes back to Active", async () => {
    await syncLoginWithStatus(
      { ...ana, status: "inactive" },
      "student",
      "active",
    );
    expect(accounts.setAccountActive).toHaveBeenCalledWith("ana", true);
    expect(accounts.listAccounts).not.toHaveBeenCalled();
    expect(toasts()).toEqual(["console.accounts.loginRestoredWithStatus"]);
  });

  it("says the demo only simulates it", async () => {
    accounts.setAccountActive.mockResolvedValue({ simulated: true });
    await syncLoginWithStatus(ana, "student", "inactive");
    expect(toasts()).toEqual(["console.accounts.loginDisabledWithStatusDemo"]);
  });

  it("leaves the login alone when the status does not cross the line", async () => {
    await syncLoginWithStatus(
      { ...ana, status: "inactive" },
      "student",
      "withdrawn",
    );
    await syncLoginWithStatus(
      { id: 2, status: "active", auth_user_id: "t" },
      "teacher",
      "on_leave",
    );
    await syncLoginWithStatus(
      { id: 3, status: "active" },
      "student",
      "inactive",
    );
    await syncLoginWithStatus(null, "student", "active");
    expect(accounts.setAccountActive).not.toHaveBeenCalled();
    expect(toasts()).toEqual(Array(4).fill("common.saved"));
  });

  it("never deactivates the signed-in user's own login", async () => {
    await syncLoginWithStatus(
      { id: 4, status: "active", auth_user_id: "me" },
      "teacher",
      "inactive",
    );
    expect(accounts.setAccountActive).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(feedback.openNotice.mock.calls[0][0]).toBe(
      "console.accounts.adminLoginKept",
    );
  });

  it("never deactivates another administrator's login", async () => {
    await syncLoginWithStatus(
      { id: 5, status: "active", auth_user_id: "dir" },
      "teacher",
      "inactive",
    );
    expect(accounts.setAccountActive).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(feedback.openNotice).toHaveBeenCalledOnce();
  });

  it("explains a failed change in a notice that outlives a toast", async () => {
    accounts.setAccountActive.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await syncLoginWithStatus(ana, "student", "inactive");
    expect(feedback.openNotice).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(feedback.openNotice.mock.calls[0][0]).toBe(
      "console.accounts.loginSyncFailed",
    );
  });

  it("does not deactivate when it cannot tell whether the login is an admin's", async () => {
    accounts.listAccounts.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await syncLoginWithStatus(ana, "student", "inactive");
    expect(accounts.setAccountActive).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(feedback.openNotice).toHaveBeenCalledOnce();
  });
});
