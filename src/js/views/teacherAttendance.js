// ─────────────────────────────────────────────────────────────────
//  teacherAttendance.js — the class workspace's Attendance tab: the daily
//  sheet plus the at-risk absence summary (item 3) shown above it.
// ─────────────────────────────────────────────────────────────────
import { t, tn } from "../i18n.js";
import { skeletonRows, skeletonBlock } from "../ui.js";
import { db } from "../teacherData/index.js";
import { state } from "../teacherState.js";
import { showToast, errorText } from "../teacherFeedback.js";
import {
  renderErrorRow,
  renderErrorBlock,
  escapeHtml,
} from "../teacherTableHelpers.js";

let _attendanceRows = [];

export function renderAttendanceTab(content) {
  const today = new Date().toISOString().split("T")[0];
  content.innerHTML = `
    <div class="absence-summary recent-activity" id="absence-summary">
      ${skeletonBlock(2)}
    </div>
    <div class="view-toolbar">
      <div class="toolbar-filters">
        <label for="attendance-date">${t("admin.attendance.date")}</label>
        <input type="date" id="attendance-date" value="${today}" />
      </div>
      <button class="btn btn-secondary" id="btn-save-attendance">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-save"></use></svg></span> ${t("admin.attendance.save")}
      </button>
    </div>
    <div class="recent-activity">
      <table class="data-table" id="attendance-table">
        <thead>
          <tr><th>${t("admin.attendance.student")}</th><th>${t("admin.attendance.status")}</th><th>${t("admin.attendance.notes")}</th></tr>
        </thead>
        <tbody id="attendance-body">
          ${skeletonRows(5, 3)}
        </tbody>
      </table>
    </div>`;

  const dateInput = document.getElementById("attendance-date");
  dateInput.addEventListener("change", () =>
    loadAttendanceSheet(dateInput.value),
  );

  const tbody = document.getElementById("attendance-body");
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest(".attendance-status-btn");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    _attendanceRows[idx].status = btn.dataset.status;
    btn
      .closest(".attendance-status-group")
      .querySelectorAll(".attendance-status-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
  tbody.addEventListener("input", (e) => {
    const input = e.target.closest(".attendance-notes-input");
    if (!input) return;
    _attendanceRows[Number(input.dataset.idx)].notes = input.value;
  });

  document
    .getElementById("btn-save-attendance")
    .addEventListener("click", saveAttendance);

  loadAttendanceSheet(today);
  loadAbsenceSummary();
}

async function loadAttendanceSheet(date) {
  const tbody = document.getElementById("attendance-body");
  tbody.innerHTML = skeletonRows(5, 3);
  try {
    _attendanceRows = await db.fetchAttendanceSheet(
      state.currentClass.classId,
      date,
    );
    _attendanceRows.forEach((row) => {
      row._original = { status: row.status, notes: row.notes ?? "" };
    });
    renderAttendanceSheet(_attendanceRows);
  } catch (err) {
    console.error(err);
    renderErrorRow("attendance-body", 3, loadAttendanceSheet);
  }
}

function renderAttendanceSheet(rows) {
  const tbody = document.getElementById("attendance-body");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="loading-cell">${t("admin.gradebook.noActiveStudents")}</td></tr>`;
    return;
  }

  const STATUSES = ["present", "absent", "late", "excused"];
  tbody.innerHTML = "";
  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    const statusButtons = STATUSES.map((s) => {
      const active = row.status === s ? " active" : "";
      return `<button type="button" class="btn btn-sm attendance-status-btn${active}"
        data-idx="${idx}" data-status="${s}">${t(`enums.attendance.${s}`)}</button>`;
    }).join("");

    tr.innerHTML = `
      <td>${escapeHtml(row.last_name)}, ${escapeHtml(row.first_name)}</td>
      <td><div class="attendance-status-group">${statusButtons}</div></td>
      <td><input type="text" class="attendance-notes-input" data-idx="${idx}"
        value="${escapeHtml(row.notes ?? "")}" placeholder="${t("admin.attendance.notePlaceholder")}"
        aria-label="${t("a11y.noteFor", { name: `${row.last_name}, ${row.first_name}` })}"></td>`;
    tbody.appendChild(tr);
  });
}

async function saveAttendance() {
  const date = /** @type {HTMLInputElement} */ (
    document.getElementById("attendance-date")
  ).value;
  if (!date) {
    showToast(t("admin.validation.pickDate"), "error");
    return;
  }
  if (!_attendanceRows.length) {
    showToast(t("admin.validation.noAttendanceData"), "error");
    return;
  }

  // Require a chosen/loaded status — a row the teacher never picked stays null and
  // is never upserted (attendance.status is non-null in the DB).
  const changed = _attendanceRows.filter(
    (row) =>
      row.status &&
      (!row._original ||
        row._original.status !== row.status ||
        row._original.notes !== (row.notes ?? "")),
  );
  if (!changed.length) {
    showToast(t("admin.validation.noChanges"), "error");
    return;
  }

  // Every sibling save disables its button for the round trip; this one did
  // not, so a second click during a slow save wrote the whole sheet twice.
  const saveBtn = /** @type {HTMLButtonElement | null} */ (
    document.getElementById("btn-save-attendance")
  );
  if (saveBtn) saveBtn.disabled = true;
  try {
    await db.upsertAttendance(
      state.currentClass.classId,
      date,
      changed,
      state.teacherId,
    );
    changed.forEach((row) => {
      row._original = { status: row.status, notes: row.notes ?? "" };
    });
    showToast(
      tn("admin.toast.attendanceSaved", changed.length, {
        count: changed.length,
      }),
    );
    loadAbsenceSummary(); // counts may have shifted a student over the threshold
  } catch (err) {
    showToast(errorText(err), "error");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── Absence summary (item 3) ────────────────────────────────
const ABSENCE_THRESHOLD = 5; // absent + late at/above this flags an at-risk student

async function loadAbsenceSummary() {
  const container = document.getElementById("absence-summary");
  if (!container) return;
  try {
    const [rows, roster] = await Promise.all([
      db.fetchClassAttendance(state.currentClass.classId),
      db.fetchRoster(state.currentClass.classId),
    ]);
    renderAbsenceSummary(rows, roster, container);
  } catch (err) {
    console.error(err);
    renderErrorBlock(container, loadAbsenceSummary);
  }
}

function renderAbsenceSummary(rows, roster, container) {
  const nameById = Object.fromEntries(
    roster.map((s) => [s.id, `${s.last_name}, ${s.first_name}`]),
  );
  const counts = {};
  rows.forEach((r) => {
    const c = (counts[r.student_id] ??= {
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
    });
    if (c[r.status] != null) c[r.status] += 1;
  });

  const flagged = Object.entries(counts)
    .map(([id, c]) => ({ id: Number(id), ...c, missed: c.absent + c.late }))
    .filter((s) => s.missed >= ABSENCE_THRESHOLD)
    .sort((a, b) => b.missed - a.missed);

  if (!flagged.length) {
    container.innerHTML = `
      <div class="absence-summary-head">
        <h3><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-monitoring"></use></svg></span> ${t("admin.absence.title")}</h3>
      </div>
      <p class="drawer-muted">${t("admin.absence.empty", { threshold: ABSENCE_THRESHOLD })}</p>`;
    return;
  }

  const chips = flagged
    .map(
      (s) => `
      <div class="absence-chip${s.absent >= ABSENCE_THRESHOLD ? " absence-high" : ""}">
        <b>${escapeHtml(nameById[s.id] ?? t("admin.absence.studentFallback", { id: s.id }))}</b>
        <span>${s.absent} ${t("enums.attendanceWord.absent")} · ${s.late} ${t("enums.attendanceWord.late")}${s.excused ? " · " + s.excused + " " + t("enums.attendanceWord.excused") : ""}</span>
      </div>`,
    )
    .join("");

  container.innerHTML = `
    <div class="absence-summary-head">
      <h3><span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-monitoring"></use></svg></span> ${t("admin.absence.title")}</h3>
      <span class="badge badge-warning">${t("admin.absence.atRisk", { count: flagged.length, threshold: ABSENCE_THRESHOLD })}</span>
    </div>
    <div class="absence-grid">${chips}</div>`;
}
