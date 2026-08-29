import { t } from "../i18n.js";
import { fetchTeachers } from "../supabaseQueries.js";
import { statusLabel } from "./viewHelpers.js";

export async function initTeachersView() {
  const teachers = await fetchTeachers();
  const container = document.getElementById("teacher-cards");

  if (!teachers || teachers.length === 0) {
    container.innerHTML = `<div class="loading-cell">${t("student.teachers.empty")}</div>`;
    return;
  }

  container.innerHTML = teachers
    .map((tch) => {
      const statusClass =
        tch.status === "active"
          ? "badge-success"
          : tch.status === "on_leave"
            ? "badge-warning"
            : "badge-danger";
      return `<div class="teacher-card">
      <div class="teacher-avatar">
        <span class="material-symbols-outlined"><svg aria-hidden="true"><use href="#icon-person"></use></svg></span>
      </div>
      <h3>${tch.first_name} ${tch.last_name}</h3>
      <p class="teacher-spec">${tch.specialization ?? "—"}</p>
      <p class="teacher-email">${tch.email ?? "—"}</p>
      <div class="teacher-status">
        <span class="badge ${statusClass}">${statusLabel(tch.status)}</span>
      </div>
    </div>`;
    })
    .join("");
}
