import { test, expect } from "@playwright/test";
import {
  REF,
  studentFix,
  teacherFix,
  consoleFix,
  scheduleFix,
  SUPA,
  routeSupabase,
  sessionSeed,
  accessTokenSeed,
} from "./fixtures.js";

// Fail the test if any uncaught error reaches the page.
function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe("login", () => {
  test("loads with locked demo credentials and hidden sign-up, no errors", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, {});
    const errors = trackErrors(page);

    await page.goto("/login.html");
    await page.waitForSelector("#auth-form");

    await expect(page.locator("#input-email")).not.toHaveValue("");
    expect(
      await page.locator("#input-email").evaluate((el) => el.readOnly),
    ).toBe(true);
    // Sign-up path is disabled in the demo.
    expect(
      await page
        .locator(".auth-switch")
        .evaluate((el) => getComputedStyle(el).display === "none")
        .catch(() => true),
    ).toBe(true);

    expect(errors).toEqual([]);
  });

  // Recovery links used to be swallowed: supabase-js consumed the tokens and
  // the page redirected the fresh session straight to a portal.
  test("an expired recovery link explains itself instead of redirecting", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, {});
    const errors = trackErrors(page);

    await page.goto(
      "/login.html#error=access_denied&error_code=otp_expired" +
        "&error_description=Email+link+is+invalid+or+has+expired&sb=",
    );
    await page.waitForSelector("#auth-form");

    await expect(page.locator("#auth-toast")).toHaveClass(/toast-error/);
    await expect(page.locator("#auth-toast")).toContainText("venció");
    // Still on the sign-in card, and the spent token is out of the URL.
    await expect(page.locator("#recovery-form")).toBeHidden();
    expect(new URL(page.url()).hash).toBe("");
    expect(new URL(page.url()).pathname).toBe("/login.html");

    expect(errors).toEqual([]);
  });

  test("a recovery link opens the set-a-new-password form", async ({
    page,
    context,
  }) => {
    const writes = await routeSupabase(context, {});
    const errors = trackErrors(page);

    await page.goto(
      "/login.html#access_token=" +
        accessTokenSeed() +
        "&refresh_token=fake-refresh&expires_in=3600" +
        "&token_type=bearer&type=recovery",
    );
    await page.waitForSelector("#recovery-form", { state: "visible" });

    await expect(page.locator("#auth-form")).toBeHidden();
    await expect(page.locator("#auth-title")).toHaveText(
      "Cree una contraseña nueva",
    );
    // Not redirected to a portal — the whole point of the fix.
    expect(new URL(page.url()).pathname).toBe("/login.html");

    // Demo mode must refuse the write rather than touch the shared account.
    await page.fill("#input-new-password", "new-password-1");
    await page.fill("#input-confirm-new", "new-password-1");
    await page.click("#btn-recovery-submit");
    await expect(page.locator("#auth-toast")).toContainText(
      "deshabilitados en la demo en vivo",
    );
    expect(writes).toEqual([]);

    expect(errors).toEqual([]);
  });

  test("mismatched passwords are caught before any request", async ({
    page,
    context,
  }) => {
    const writes = await routeSupabase(context, {});

    await page.goto(
      "/login.html#access_token=" +
        accessTokenSeed() +
        "&refresh_token=fake-refresh&expires_in=3600" +
        "&token_type=bearer&type=recovery",
    );
    await page.waitForSelector("#recovery-form", { state: "visible" });

    await page.fill("#input-new-password", "new-password-1");
    await page.fill("#input-confirm-new", "new-password-2");
    await page.click("#btn-recovery-submit");

    await expect(page.locator("#error-confirm-new")).toContainText(
      "no coinciden",
    );
    expect(writes).toEqual([]);
  });

  test("forgot-password is hidden in demo mode", async ({ page, context }) => {
    await routeSupabase(context, {});
    await page.goto("/login.html");
    await page.waitForSelector("#auth-form");
    await expect(page.locator("#forgot-row")).toBeHidden();
  });
});

test.describe("student portal", () => {
  test("dashboard renders mocked data and the theme toggles", async ({
    page,
    context,
  }) => {
    const writes = await routeSupabase(context, studentFix);
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );
    const errors = trackErrors(page);

    await page.goto("/");
    await page.waitForFunction(
      () =>
        document.getElementById("welcome-name")?.textContent?.includes("Ana"),
      { timeout: 10_000 },
    );

    await expect(page.locator("#attendance-pct")).toContainText("%");
    await expect(page.locator("#grade-avg")).not.toHaveText("");
    await expect(page.locator("#upcoming-events-card")).toContainText(
      "Final Exams",
    );

    // Theme toggle flips the <html> dark class.
    const before = await page.evaluate(() =>
      document.documentElement.classList.contains("dark-theme-variables"),
    );
    await page.click(".theme-toggler");
    const after = await page.evaluate(() =>
      document.documentElement.classList.contains("dark-theme-variables"),
    );
    expect(after).toBe(!before);

    expect(errors).toEqual([]);
    // Student portal is read-only; nothing should write to the backend.
    expect(writes).toEqual([]);
  });
});

test.describe("teacher console", () => {
  test("loads the teacher workspace in demo mode with zero writes", async ({
    page,
    context,
  }) => {
    const writes = await routeSupabase(context, teacherFix);
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );
    const errors = trackErrors(page);

    await page.goto("/teacher.html");
    await page.waitForFunction(
      () =>
        document.getElementById("teacher-name")?.textContent?.includes("Sofía"),
      { timeout: 10_000 },
    );
    await expect(page.locator(".demo-badge").first()).toBeVisible();

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("Logout leaves the console instead of bouncing back", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, teacherFix);
    // Seeded once, deliberately not via addInitScript: re-seeding on every
    // navigation would put the session back and mask the bounce.
    await page.goto("/login.html");
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );

    await page.goto("/teacher.html");
    await page.waitForFunction(
      () =>
        document.getElementById("teacher-name")?.textContent?.includes("Sofía"),
      { timeout: 10_000 },
    );

    await page.click("#logout-btn");
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toBe("/login.html");
  });
});

test.describe("admin console", () => {
  test("Logout leaves the console instead of bouncing back", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, consoleFix);
    await page.goto("/login.html");
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );

    await page.goto("/admin.html");
    await page.waitForFunction(
      () =>
        document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
      { timeout: 10_000 },
    );

    // The button is an <a href="/login.html">; the handler must stop the
    // browser following it until signOut() has cleared the session, or the
    // admin role gate routes straight back to /admin.html.
    await page.click("#logout-btn");
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toBe("/login.html");
  });

  test("loads the shell, does academic-structure CRUD, and never writes", async ({
    page,
    context,
  }) => {
    const writes = await routeSupabase(context, consoleFix);
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );
    const errors = trackErrors(page);

    await page.goto("/admin.html");
    await page.waitForFunction(
      () =>
        document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
      { timeout: 10_000 },
    );
    await expect(page.locator("#overview-year-text")).toContainText(
      "2025-2026",
    );
    await expect(page.locator(".demo-badge").first()).toBeVisible();

    // Year & Periods: the seeded year renders; adding one shows optimistically.
    await page.click('.sidebar a[data-page="yearperiods"]');
    await expect(page.locator("#years-body")).toContainText("2025-2026");
    await page.click("#btn-add-year");
    await page.fill("#modal-field-name", "2026-2027");
    await page.fill("#modal-field-start_date", "2026-09-01");
    await page.fill("#modal-field-end_date", "2027-06-30");
    await page.click("#modal-submit");
    await expect(page.locator("#years-body")).toContainText("2026-2027");

    // Students & Enrollment renders its roster panel (empty seed → prompt).
    await page.click('.sidebar a[data-page="students"]');
    await expect(page.locator("#view-students .console-panel")).toBeVisible();
    await expect(page.locator("#students-body")).toContainText(/No students/);

    expect(errors).toEqual([]);
    // Demo mode: the write landed in the in-browser overlay, not Supabase.
    expect(writes).toEqual([]);
  });

  test("builds a section's week, warns on a double-booked teacher, and copies it", async ({
    page,
    context,
  }) => {
    const writes = await routeSupabase(context, scheduleFix);
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );
    const errors = trackErrors(page);

    await page.goto("/admin.html");
    await page.waitForFunction(
      () =>
        document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
      { timeout: 10_000 },
    );

    await page.click('.sidebar a[data-page="schedules"]');
    // Section A's seeded Monday class renders in the weekly grid.
    await expect(page.locator("#sched-grid")).toContainText("Mathematics");
    await expect(page.locator("#sched-grid")).toContainText("Ana Rojas");

    // Add a second period to the same section — no conflict, saves directly.
    await page.click("#btn-sched-add");
    await page.selectOption("#modal-field-day_of_week", { label: "Tuesday" });
    await page.fill("#modal-field-start_time", "10:00");
    await page.fill("#modal-field-end_time", "11:00");
    await page.selectOption("#modal-field-subject_id", { label: "Biology" });
    await page.selectOption("#modal-field-teacher_id", { label: "Luis Mora" });
    await page.click("#modal-submit");
    await expect(page.locator("#sched-grid")).toContainText("Biology");

    // Same slot in Section B with the teacher already booked in Section A:
    // the console warns rather than blocking, and the override writes.
    await page.selectOption("#sched-section-picker", {
      label: "10th Grade — Section B",
    });
    await page.click("#btn-sched-add");
    await page.selectOption("#modal-field-day_of_week", { label: "Monday" });
    await page.fill("#modal-field-start_time", "08:00");
    await page.fill("#modal-field-end_time", "09:00");
    await page.selectOption("#modal-field-subject_id", {
      label: "Mathematics",
    });
    await page.selectOption("#modal-field-teacher_id", { label: "Ana Rojas" });
    await page.click("#modal-submit");
    await expect(page.locator("#confirm-overlay")).toHaveClass(/active/);
    await expect(page.locator("#confirm-message")).toContainText("Ana Rojas");
    await page.click("#confirm-delete");
    await expect(page.locator("#sched-grid")).toContainText("Mathematics");
    // The clash now shows in the passive year-wide conflicts panel.
    await expect(page.locator(".sched-conflict-list")).toContainText(
      "Ana Rojas",
    );

    // Copying Section A's week into B skips the slot B already has.
    await page.click('#view-schedules button:has-text("Copy from")');
    await page.selectOption("#modal-field-source_id", {
      label: "10th Grade — Section A",
    });
    await page.click("#modal-submit");
    await expect(page.locator("#confirm-overlay")).toHaveClass(/active/);
    await page.click("#confirm-delete");
    await expect(page.locator("#sched-grid")).toContainText("Biology");

    expect(errors).toEqual([]);
    // Demo mode: every write above landed in the in-browser overlay.
    expect(writes).toEqual([]);
  });

  // The schedules tables ship as a hand-applied schema snippet, so a project
  // can legitimately be running the new console without them. Losing the
  // templates or the day config must not take the whole tab down.
  test("schedules tab still works on a project without the new tables", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, scheduleFix);
    // Registered after the fixture catch-all: Playwright gives precedence to
    // the most recently added matching route.
    for (const table of [
      "schedule_configs",
      "bell_schedules",
      "bell_schedule_blocks",
    ]) {
      await context.route(`${SUPA}/rest/v1/${table}*`, (route) =>
        route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            code: "42P01",
            message: `relation "public.${table}" does not exist`,
          }),
        }),
      );
    }
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );
    const errors = trackErrors(page);

    await page.goto("/admin.html");
    await page.waitForFunction(
      () =>
        document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
      { timeout: 10_000 },
    );
    await page.click('.sidebar a[data-page="schedules"]');

    // The grid renders from `schedules` alone, on the Mon–Fri default.
    await expect(page.locator("#sched-grid")).toContainText("Mathematics");
    await expect(page.locator("#schedules-root")).not.toContainText(
      "Failed to load",
    );
    expect(
      await page.locator("#sched-grid .sched-head").allInnerTexts(),
    ).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    // No templates to offer, but the picker still works.
    expect(
      await page.locator("#sched-template-picker option").allInnerTexts(),
    ).toEqual(["Free times (no template)"]);

    expect(errors).toEqual([]);
  });

  test("bounces a teacher-role profile to the teacher console", async ({
    page,
    context,
  }) => {
    await routeSupabase(context, teacherFix);
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );

    await page.goto("/admin.html");
    await page.waitForURL("**/teacher.html", { timeout: 10_000 });
    await page.waitForFunction(
      () =>
        document.getElementById("teacher-name")?.textContent?.includes("Sofía"),
      { timeout: 10_000 },
    );
  });

  test("enrolls a student and CSV-imports a roster with zero writes", async ({
    page,
    context,
  }) => {
    const seeded = {
      ...consoleFix,
      grade_levels: [{ id: 1, name: "7th Grade", numeric_level: 7 }],
      classes: [
        {
          id: 21,
          school_year_id: 1,
          grade_level_id: 1,
          section: "A",
          display_name: "7A",
        },
      ],
      students: [],
    };
    const writes = await routeSupabase(context, seeded);
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );
    const errors = trackErrors(page);

    await page.goto("/admin.html");
    await page.waitForFunction(() =>
      document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
    );
    await page.click('.sidebar a[data-page="students"]');

    // Add one student enrolled into 7th Grade section A. Sections are labelled
    // for humans now ("7th Grade — Section A"), not by their storage code.
    await page.click("#btn-add-student");
    await page.fill("#modal-field-first_name", "Ana");
    await page.fill("#modal-field-last_name", "García");
    await page.fill("#modal-field-enrollment_number", "S-101");
    await page.selectOption("#modal-field-class_id", {
      label: "7th Grade — Section A",
    });
    await page.click("#modal-submit");
    await expect(page.locator("#students-body")).toContainText("Ana García");

    // CSV import: paste 3 rows (one with a blank enrollment → auto-generated).
    await page.click("#btn-import-csv");
    await page.fill(
      "#import-text",
      "first_name,last_name,enrollment_number,gender\n" +
        "Luis,Martínez,S-102,M\nMaría,Rojas,S-103,F\nCarlos,Díaz,,M",
    );
    await page.selectOption("#import-section", {
      label: "7th Grade — Section A",
    });
    await page.click("#import-footer .btn-primary"); // → mapping
    await expect(page.locator(".map-grid")).toBeVisible();
    await page.click("#import-footer .btn-primary"); // → preview
    await expect(page.locator(".import-summary")).toContainText("3");
    await page.click("#import-footer .btn-primary"); // → import
    await expect(page.locator("#students-body")).toContainText("Carlos Díaz");

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("overview shows enrollment, attendance rate and structure counts", async ({
    page,
    context,
  }) => {
    // Local-time dates, matching how the console builds its month window
    // (toISOString() would drift a day either side of UTC midnight).
    const pad = (n) => String(n).padStart(2, "0");
    const iso = (d) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    const today = iso(now);
    const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const lastMonth = (day) =>
      iso(new Date(now.getFullYear(), now.getMonth() - 1, day));
    const seeded = {
      ...consoleFix,
      school_settings: [{ id: 1, name: "Colegio San José", id_label: null }],
      grade_levels: [{ id: 1, name: "7th Grade", numeric_level: 7 }],
      teachers: [
        { id: 71, first_name: "Sofía", last_name: "Ramírez", status: "active" },
        { id: 72, first_name: "Diego", last_name: "Soto", status: "inactive" },
      ],
      subjects: [
        { id: 31, name: "Mathematics", code: "MATH7" },
        { id: 32, name: "Science", code: "SCI7" },
      ],
      rooms: [
        { id: 5, name: "Aula 1", capacity: 30, type: "classroom" },
        { id: 6, name: "Aula 2", capacity: 30, type: "classroom" },
      ],
      classes: [
        {
          id: 21,
          school_year_id: 1,
          grade_level_id: 1,
          section: "A",
          display_name: "7A",
          room_id: 5,
        },
      ],
      students: [
        {
          id: 101,
          first_name: "Ana",
          last_name: "García",
          status: "active",
          class_id: 21,
        },
        {
          id: 102,
          first_name: "Luis",
          last_name: "Martínez",
          status: "active",
          class_id: 21,
        },
        {
          id: 103,
          first_name: "María",
          last_name: "Rojas",
          status: "inactive",
          class_id: 21,
        },
      ],
      // Four rows inside the current month — 3 present/late of 4 = 75% — and
      // three absences in the month before it. The older rows still feed the
      // at-risk count (which spans the whole record) but must stay out of the
      // month's rate, which is what separates this from the old daily figure.
      attendance: [
        {
          id: 1,
          student_id: 101,
          class_id: 21,
          date: today,
          status: "present",
        },
        { id: 2, student_id: 102, class_id: 21, date: today, status: "absent" },
        {
          id: 6,
          student_id: 101,
          class_id: 21,
          date: monthStart,
          status: "present",
        },
        {
          id: 7,
          student_id: 102,
          class_id: 21,
          date: monthStart,
          status: "late",
        },
        {
          id: 3,
          student_id: 101,
          class_id: 21,
          date: lastMonth(10),
          status: "absent",
        },
        {
          id: 4,
          student_id: 101,
          class_id: 21,
          date: lastMonth(11),
          status: "absent",
        },
        {
          id: 5,
          student_id: 101,
          class_id: 21,
          date: lastMonth(12),
          status: "absent",
        },
      ],
    };
    const writes = await routeSupabase(context, seeded);
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );
    const errors = trackErrors(page);

    await page.goto("/admin.html");
    await expect(page.locator("#stat-enrollment")).toHaveText("2");
    // 3 present/late of the 4 rows dated this month. Were last month's three
    // absences counted, this would read 43%.
    await expect(page.locator("#stat-attendance")).toHaveText("75%");
    // The hint names the month and the sample size behind the percentage.
    const monthName = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(new Date(now.getFullYear(), now.getMonth(), 1));
    await expect(page.locator("#stat-attendance-hint")).toHaveText(
      `${monthName} · 4 records`,
    );
    // At-risk is a summary figure now — the per-student table it used to sit
    // above was demoted off the dashboard.
    await expect(page.locator("#stat-atrisk")).toHaveText("1");
    await expect(page.locator("#atrisk-body")).toHaveCount(0);

    // Structure counts: active teachers, subjects, this year's sections, and
    // room utilization (1 of 2 rooms occupied).
    await expect(page.locator("#stat-teachers")).toHaveText("1");
    await expect(page.locator("#stat-subjects")).toHaveText("2");
    await expect(page.locator("#stat-sections")).toHaveText("1");
    await expect(page.locator("#stat-rooms")).toHaveText("1/2");

    // The heading carries the school's own name.
    await expect(page.locator("#overview-heading")).toHaveText(
      "Colegio San José",
    );

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("create-login is simulated in demo mode and never calls the backend", async ({
    page,
    context,
  }) => {
    const seeded = {
      ...consoleFix,
      teachers: [
        {
          id: 7,
          first_name: "Sofía",
          last_name: "Ramírez",
          email: "sofia@example.com",
          status: "active",
          auth_user_id: null,
        },
      ],
    };
    const writes = await routeSupabase(context, seeded);
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );
    const errors = trackErrors(page);

    await page.goto("/admin.html");
    await page.waitForFunction(() =>
      document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
    );
    await page.click('.sidebar a[data-page="teachers"]');
    await expect(page.locator("#teachers-body")).toContainText("Sofía");

    await page.click('#teachers-body button[title="Create login"]');
    await expect(page.locator("#modal-field-email")).toHaveValue(
      "sofia@example.com",
    );
    await page.click("#modal-submit");
    // Row flips to reset-password (link reflected locally in demo).
    await expect(
      page.locator('#teachers-body button[title="Reset password"]'),
    ).toBeVisible();

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("generic CSV import handles teachers, grade levels and sections", async ({
    page,
    context,
  }) => {
    const seeded = {
      ...consoleFix,
      grade_levels: [{ id: 1, name: "7th Grade", numeric_level: 7 }],
      rooms: [{ id: 41, name: "Room 101", capacity: 30, type: "classroom" }],
      teachers: [
        {
          id: 7,
          first_name: "Sofía",
          last_name: "Ramírez",
          email: "sofia@x.com",
          status: "active",
        },
      ],
      classes: [],
    };
    const writes = await routeSupabase(context, seeded);
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [`sb-${REF}-auth-token`, sessionSeed()],
    );
    const errors = trackErrors(page);

    const runImport = async (btn, csv) => {
      await page.click(btn);
      await expect(page.locator("#import-overlay")).toHaveClass(/active/);
      await page.fill("#import-text", csv);
      await page.click("#import-footer .btn-primary"); // → mapping
      await expect(page.locator(".map-grid")).toBeVisible();
      await page.click("#import-footer .btn-primary"); // → preview
      await expect(page.locator(".import-summary")).toBeVisible();
      await page.click("#import-footer .btn-primary"); // → import
    };

    await page.goto("/admin.html");
    await page.waitForFunction(() =>
      document.getElementById("admin-name")?.textContent?.includes("Gabriel"),
    );

    // Teachers.
    await page.click('.sidebar a[data-page="teachers"]');
    await runImport(
      "#btn-import-teachers",
      "first_name,last_name,email\nMarco,López,marco@x.com",
    );
    await expect(page.locator("#teachers-body")).toContainText("Marco López");

    // Grade levels, then sections (grade by number, homeroom + room by name).
    await page.click('.sidebar a[data-page="gradessections"]');
    await runImport("#btn-import-grades", "numeric_level,name\n8,8th Grade");
    await expect(page.locator("#grades-body")).toContainText("8th Grade");

    await runImport(
      "#btn-import-sections",
      "grade,section,homeroom,room\n7,A,Sofía Ramírez,Room 101",
    );
    await expect(page.locator("#sections-body")).toContainText("7th Grade");
    await expect(page.locator("#sections-body")).toContainText("Sofía Ramírez");

    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
});
