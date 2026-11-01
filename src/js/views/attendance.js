import { t, formatDate } from "../i18n.js";
import { fetchStudentAttendance } from "../supabaseQueries.js";
import { state } from "../studentState.js";
import { escapeHtml } from "../html.js";

export async function initAttendanceView() {
  const records = await fetchStudentAttendance(state.studentId);

  const summary = document.getElementById("attendance-summary");
  const total = records.length;
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  records.forEach((r) => {
    if (counts[r.status] !== undefined) counts[r.status]++;
  });

  summary.innerHTML = [
    {
      label: t("enums.attendance.present"),
      val: counts.present,
      cls: "stat-present",
    },
    {
      label: t("enums.attendance.absent"),
      val: counts.absent,
      cls: "stat-absent",
    },
    { label: t("enums.attendance.late"), val: counts.late, cls: "stat-late" },
    {
      label: t("enums.attendance.excused"),
      val: counts.excused,
      cls: "stat-excused",
    },
  ]
    .map(
      (s) => `
    <div class="att-stat ${s.cls}">
      <h2>${s.val}</h2>
      <p>${s.label}</p>
    </div>
  `,
    )
    .join("");

  const tbody = document.getElementById("attendance-body");

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">${t("student.attendance.empty")}</td></tr>`;
    return;
  }

  tbody.innerHTML = records
    .map((r) => {
      const statusCls = `status-${r.status}`;
      // fetchStudentAttendance attaches the recorder as `r.teacher` (singular);
      // reading `r.teachers` here left this column always blank ("—").
      const teacher = r.teacher;
      // Attendance is per subject. Rows predating that migration carry no
      // class_subject_teacher_id, and the section name is the only label they
      // have — so fall back to it rather than showing them as unattributed.
      const subject =
        r.class_subject_teachers?.subjects?.name ??
        r.classes?.display_name ??
        "—";
      return `<tr>
      <td>${formatDate(r.date)}</td>
      <td>${escapeHtml(subject)}</td>
      <td><span class="status-badge ${statusCls}">${attendanceLabel(r.status)}</span></td>
      <td>${teacher ? escapeHtml(`${teacher.first_name} ${teacher.last_name}`) : "—"}</td>
      <td>${escapeHtml(r.notes ?? "—")}</td>
    </tr>`;
    })
    .join("");
}

// Attendance status badge label from the DB status value.
function attendanceLabel(status) {
  return t(`enums.attendance.${status}`);
}
