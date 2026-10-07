// ─────────────────────────────────────────────────────────────────
//  guardians.js — a student's guardians (encargados), opened from the
//  students table. A guardian record can be linked to several students
//  (siblings), so editing one changes it for all of them; removing a
//  guardian from their last student deletes the record.
// ─────────────────────────────────────────────────────────────────
import { registerDialog } from "../../dialog.js";
import { t } from "../../i18n.js";
import * as v from "../../validate.js";
import { data } from "../data.js";
import { escapeHtml, nullable } from "../ui/format.js";
import { showToast, openConfirm } from "../ui/feedback.js";
import { openModal } from "../ui/modal.js";
import { iconBtn, tableRow, renderErrorBlock } from "../ui/tables.js";

const overlay = document.getElementById("guardians-overlay");
const body = document.getElementById("guardians-body");

/** @type {any} the student whose guardians are showing */
let student = null;
/** @type {any[]} that student's student_guardians rows */
let links = [];
/** @type {Map<number, any>} guardian rows by id */
let guardiansById = new Map();
/** A write is in flight; further row actions wait for it. */
let busy = false;
/**
 * Bumped whenever the dialog opens or closes. Anything that awaits checks it
 * afterwards, so an answer that arrives late can never act on a student
 * other than the one it was asked for.
 */
let session = 0;
/** Bumped by every refresh, so only the latest one renders. */
let loads = 0;

const footer = ["guardians-link", "guardians-add"].map((id) =>
  document.getElementById(id),
);
/** Adding or linking waits until the student's list is known. */
function setFooterReady(/** @type {boolean} */ ready) {
  for (const button of footer)
    if (button instanceof HTMLButtonElement) button.disabled = !ready;
}

const fullName = (/** @type {any} */ p) =>
  `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();

function close() {
  overlay?.classList.remove("active");
  student = null;
  session++;
}
document.getElementById("guardians-close")?.addEventListener("click", close);
document
  .getElementById("guardians-add")
  ?.addEventListener("click", () => openGuardianForm());
document
  .getElementById("guardians-link")
  ?.addEventListener("click", openLinkExisting);
registerDialog(overlay, { close });

/** @param {any} target the students row */
export async function openGuardians(target) {
  session++;
  student = target;
  setFooterReady(false);
  links = [];
  guardiansById = new Map();
  const title = document.getElementById("guardians-title");
  if (title)
    title.textContent = t("console.guardians.title", {
      name: fullName(target),
    });
  if (body)
    body.innerHTML = `<p class="panel-sub">${escapeHtml(t("common.loading"))}</p>`;
  overlay?.classList.add("active");
  await refresh();
}

async function refresh() {
  const target = student;
  if (!target || !body) return;
  const mine = session;
  const load = ++loads;
  const stale = () => mine !== session || load !== loads;
  try {
    const rows = await data.listStudentGuardians(target.id);
    const ids = rows.map((l) => l.guardian_id);
    const guardians = ids.length ? await data.listGuardiansByIds(ids) : [];
    if (stale()) return;
    links = rows;
    guardiansById = new Map(guardians.map((g) => [g.id, g]));
    render();
    setFooterReady(true);
  } catch (err) {
    if (stale()) return;
    console.error("guardians:", err);
    renderErrorBlock(body, refresh);
  }
}

/** A re-render drops the row button that had focus; keep focus in the dialog. */
function keepFocus() {
  const active = document.activeElement;
  if (!overlay?.classList.contains("active")) return;
  if (active && active !== document.body && document.contains(active)) return;
  /** @type {HTMLElement | null} */ (
    overlay.querySelector('[role="dialog"]')
  )?.focus();
}

function render() {
  if (!links.length) {
    body.innerHTML = `<p class="panel-sub">${escapeHtml(t("console.guardians.empty"))}</p>`;
    return;
  }
  body.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th>${escapeHtml(t("console.guardians.name"))}</th>
          <th>${escapeHtml(t("console.guardians.relationship"))}</th>
          <th>${escapeHtml(t("console.guardians.nationalId"))}</th>
          <th>${escapeHtml(t("console.guardians.phone"))}</th>
          <th>${escapeHtml(t("console.guardians.email"))}</th>
          <th class="actions-col"></th>
        </tr></thead>
        <tbody id="guardians-rows"></tbody>
      </table>
    </div>`;
  const tbody = body.querySelector("#guardians-rows");
  const ordered = [...links].sort(
    (a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)),
  );
  for (const link of ordered) {
    const g = guardiansById.get(link.guardian_id) ?? {};
    const primary = link.is_primary
      ? ` <span class="badge badge-success">${escapeHtml(t("console.guardians.primary"))}</span>`
      : "";
    const actions = [
      iconBtn("edit", t("common.edit"), () => openGuardianForm(g)),
    ];
    if (!link.is_primary)
      actions.push(
        iconBtn("grade", t("console.guardians.makePrimary"), () =>
          makePrimary(link),
        ),
      );
    actions.push(
      iconBtn(
        "block",
        t("console.guardians.unlink"),
        () => confirmUnlink(link, g),
        true,
      ),
    );
    tbody.appendChild(
      tableRow(
        [
          escapeHtml(fullName(g)) + primary,
          escapeHtml(g.relationship ?? "—"),
          escapeHtml(g.national_id ?? "—"),
          escapeHtml(g.phone ?? "—"),
          escapeHtml(g.email ?? "—"),
        ],
        actions,
      ),
    );
  }
}

async function makePrimary(link) {
  if (busy) return;
  busy = true;
  try {
    await data.setPrimaryGuardian(
      link.id,
      links.filter((l) => l.is_primary).map((l) => l.id),
    );
    showToast(t("common.saved"));
  } catch (err) {
    console.error("makePrimary:", err);
    showToast(t("console.guardians.saveFailed"), "error");
  } finally {
    busy = false;
    await refresh();
    keepFocus();
  }
}

async function confirmUnlink(link, guardian) {
  if (busy) return;
  const target = student;
  const mine = session;
  const others = links.filter((l) => l.id !== link.id);
  let lastStudent = false;
  try {
    lastStudent = (await data.listGuardianLinks(link.guardian_id)).length <= 1;
  } catch {
    /* keep the record when in doubt */
  }
  if (mine !== session) return;
  const names = { guardian: fullName(guardian), student: fullName(target) };
  openConfirm(
    t(
      lastStudent
        ? "console.guardians.confirmUnlinkLast"
        : "console.guardians.confirmUnlink",
      names,
    ),
    async () => {
      busy = true;
      try {
        // Hand the primary role on before removing, so a failure part-way
        // never leaves the student without one.
        if (link.is_primary && others.length)
          await data.setPrimaryGuardian(others[0].id, [link.id]);
        await data.unlinkGuardian(link.id);
        // Asked again: a link made to another student since the confirm
        // opened would go with the record.
        if (
          lastStudent &&
          !(await data.listGuardianLinks(link.guardian_id)).length
        )
          await data.deleteGuardian(link.guardian_id);
        showToast(t("common.saved"));
      } finally {
        busy = false;
        await refresh();
      }
    },
    {
      title: t("console.guardians.unlinkTitle"),
      confirmLabel: t(
        lastStudent
          ? "console.guardians.unlinkDelete"
          : "console.guardians.unlink",
      ),
    },
  );
}

async function openLinkExisting() {
  const target = student;
  if (!target) return;
  const mine = session;
  let all;
  try {
    all = await data.listGuardians();
  } catch (err) {
    if (mine !== session) return;
    console.error("listGuardians:", err);
    showToast(t("common.loadFailed"), "error");
    return;
  }
  if (mine !== session) return;
  const linked = new Set(links.map((l) => l.guardian_id));
  const candidates = all.filter((g) => !linked.has(g.id));
  if (!candidates.length) {
    showToast(t("console.guardians.noOthers"));
    return;
  }
  openModal({
    title: t("console.guardians.linkTitle"),
    submitLabel: t("console.guardians.link"),
    fields: [
      {
        name: "guardian_id",
        label: t("console.guardians.pick"),
        type: "select",
        required: true,
        options: candidates.map((g) => ({
          value: g.id,
          label: g.national_id
            ? `${g.last_name}, ${g.first_name} · ${g.national_id}`
            : `${g.last_name}, ${g.first_name}`,
        })),
      },
    ],
    onSubmit: async (values) => {
      await data.linkGuardian({
        student_id: target.id,
        guardian_id: Number(values.guardian_id),
        is_primary: links.length === 0,
      });
      showToast(t("common.saved"));
      await refresh();
    },
  });
}

/**
 * An ID number already on file names its guardian, so the admin can link
 * them instead of entering them twice.
 * @param {any[]} guardians
 * @param {any} [current] the guardian being edited
 */
function nationalIdFree(guardians, current) {
  const key = (/** @type {any} */ id) =>
    String(id ?? "")
      .trim()
      .toLowerCase();
  return (/** @type {any} */ value) => {
    if (!key(value)) return null;
    const hit = guardians.find(
      (g) => g.id !== current?.id && key(g.national_id) === key(value),
    );
    return hit
      ? { key: "console.guardians.idInUse", vars: { name: fullName(hit) } }
      : null;
  };
}

/** @param {any} [guardian] an existing guardian to edit */
async function openGuardianForm(guardian = null) {
  const target = student;
  if (!target) return;
  const mine = session;
  let all = [];
  let shared = false;
  try {
    [all, shared] = await Promise.all([
      data.listGuardians(),
      guardian
        ? data.listGuardianLinks(guardian.id).then((rows) => rows.length > 1)
        : false,
    ]);
  } catch {
    /* the database's unique constraint still refuses a duplicate */
  }
  if (mine !== session) return;
  /** @type {any} created on a first submit whose link then failed */
  let created = null;
  openModal({
    title: guardian
      ? t("console.guardians.editTitle")
      : t("console.guardians.addTitle"),
    fields: [
      {
        name: "first_name",
        maxLength: 100,
        label: t("console.guardians.firstName"),
        value: guardian?.first_name,
        required: true,
        help: shared ? t("console.guardians.sharedHelp") : undefined,
      },
      {
        name: "last_name",
        maxLength: 100,
        label: t("console.guardians.lastName"),
        value: guardian?.last_name,
        required: true,
      },
      {
        name: "relationship",
        maxLength: 50,
        label: t("console.guardians.relationship"),
        value: guardian?.relationship,
        placeholder: t("console.guardians.relationshipPlaceholder"),
      },
      {
        name: "national_id",
        maxLength: 20,
        label: t("console.guardians.nationalId"),
        value: guardian?.national_id,
        rules: [nationalIdFree(all, guardian)],
      },
      {
        name: "phone",
        maxLength: 20,
        label: t("console.guardians.phone"),
        value: guardian?.phone,
        rules: [v.phone()],
      },
      {
        name: "alt_phone",
        maxLength: 20,
        label: t("console.guardians.altPhone"),
        value: guardian?.alt_phone,
        rules: [v.phone()],
      },
      {
        name: "email",
        maxLength: 150,
        type: "email",
        label: t("console.guardians.email"),
        value: guardian?.email,
        rules: [v.email()],
      },
      {
        name: "occupation",
        maxLength: 100,
        label: t("console.guardians.occupation"),
        value: guardian?.occupation,
      },
      {
        name: "address",
        type: "textarea",
        label: t("console.guardians.address"),
        value: guardian?.address,
      },
    ],
    onSubmit: async (values) => {
      const payload = {
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
        relationship: nullable(values.relationship),
        national_id: nullable(values.national_id),
        phone: nullable(values.phone),
        alt_phone: nullable(values.alt_phone),
        email: nullable(values.email),
        occupation: nullable(values.occupation),
        address: nullable(values.address),
      };
      if (guardian) {
        await data.updateGuardian(guardian.id, payload);
      } else {
        if (created) await data.updateGuardian(created.id, payload);
        else created = await data.createGuardian(payload);
        await data.linkGuardian({
          student_id: target.id,
          guardian_id: created.id,
          is_primary: links.length === 0,
        });
      }
      showToast(t("common.saved"));
      await refresh();
    },
  });
}
