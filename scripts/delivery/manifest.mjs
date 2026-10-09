import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} Check
 * @property {string} id
 * @property {string} sql
 * @property {number} expect
 */

/**
 * @typedef {object} Unit
 * @property {number} seq
 * @property {string} id
 * @property {string[]} files
 * @property {ProjectType[]} appliesTo
 * @property {string[]} functions
 * @property {string[]} auth
 * @property {Check[]} checks
 */

/** @typedef {{ units: Unit[] }} Manifest */

/** @typedef {"demo" | "school"} ProjectType */

/**
 * @typedef {object} WindowSlot
 * @property {number[]} days
 * @property {string} from
 * @property {string} to
 */

/**
 * @typedef {object} DeliveryWindow
 * @property {string} timezone
 * @property {WindowSlot[]} slots
 */

/**
 * @typedef {object} Project
 * @property {string} name
 * @property {string} ref
 * @property {ProjectType} type
 * @property {string} site
 * @property {string} origin
 * @property {boolean} holdsRealData
 * @property {DeliveryWindow | null} window
 */

/** @typedef {{ projects: Project[] }} ProjectList */

/** @type {readonly ProjectType[]} */
export const PROJECT_TYPES = ["demo", "school"];

export const MANIFEST_PATH = "supabase/delivery/manifest.json";
export const PROJECTS_PATH = "supabase/delivery/projects.json";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REF = /^[a-z]{20}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} value */
const isText = (value) => typeof value === "string" && value.trim() !== "";

/** @param {unknown} value */
const isTextList = (value) => Array.isArray(value) && value.every(isText);

/**
 * True for one statement that starts with `select`. One trailing `;` is
 * allowed; any other `;` means more than one statement.
 * @param {unknown} sql
 * @returns {boolean}
 */
export function isSingleSelect(sql) {
  if (typeof sql !== "string") return false;
  const body = sql.trim().replace(/;\s*$/, "");
  return /^select\b/i.test(body) && !body.includes(";");
}

/**
 * @param {Record<string, any>} unit
 * @param {Set<string>} schemaFiles
 * @returns {string[]}
 */
function unitProblems(unit, schemaFiles) {
  const problems = [];

  if (!Array.isArray(unit.files) || unit.files.length === 0) {
    problems.push("files must list at least one supabase/schema/ file");
  } else {
    for (const file of unit.files) {
      const plain =
        typeof file === "string" &&
        !/[\\/]/.test(file) &&
        file.endsWith(".sql");
      if (!plain || !schemaFiles.has(file)) {
        problems.push(
          `file ${JSON.stringify(file)} is not a .sql file in supabase/schema/`,
        );
      }
    }
  }

  const types = unit.appliesTo;
  if (
    !Array.isArray(types) ||
    types.length === 0 ||
    new Set(types).size !== types.length ||
    !types.every((type) => PROJECT_TYPES.includes(type))
  ) {
    problems.push(
      `appliesTo ${JSON.stringify(types)} must list project types from ${PROJECT_TYPES.join(", ")} without repeats`,
    );
  }

  if (!isTextList(unit.functions)) {
    problems.push("functions must be a list of function names");
  }
  if (!isTextList(unit.auth)) {
    problems.push("auth must be a list of Auth changes");
  }

  if (!Array.isArray(unit.checks)) {
    problems.push("checks must be a list");
  } else {
    const checkIds = new Set();
    unit.checks.forEach((check, index) => {
      if (!isObject(check)) {
        problems.push(`check #${index + 1} is not an object`);
        return;
      }
      const label = isText(check.id)
        ? `check ${JSON.stringify(check.id)}`
        : `check #${index + 1}`;
      if (!KEBAB.test(check.id ?? "")) {
        problems.push(`${label} needs a lower-case kebab id`);
      } else if (checkIds.has(check.id)) {
        problems.push(`${label} is repeated`);
      }
      checkIds.add(check.id);
      if (!isSingleSelect(check.sql)) {
        problems.push(`${label} is not a single select statement`);
      }
      if (typeof check.expect !== "number" || !Number.isFinite(check.expect)) {
        problems.push(`${label} needs a numeric expect`);
      }
    });
  }

  return problems;
}

/**
 * Every problem with a manifest, as one reason per line. Empty when valid.
 * @param {unknown} data
 * @param {Iterable<string>} schemaFiles the names in supabase/schema/
 * @returns {string[]}
 */
export function checkManifest(data, schemaFiles) {
  if (!isObject(data) || !Array.isArray(data.units)) {
    return ['the manifest needs a "units" list'];
  }

  const files = new Set(schemaFiles);
  const ids = new Set();
  /** @type {string[]} */
  const problems = [];
  let lastSeq = 0;

  data.units.forEach((unit, index) => {
    if (!isObject(unit)) {
      problems.push(`unit #${index + 1} is not an object`);
      return;
    }
    const label = isText(unit.id)
      ? `unit ${JSON.stringify(unit.id)}`
      : `unit #${index + 1}`;

    if (!Number.isInteger(unit.seq) || unit.seq < 1) {
      problems.push(`${label}: sequence must be a positive whole number`);
    } else if (unit.seq <= lastSeq) {
      problems.push(
        `${label}: sequence ${unit.seq} must be greater than the previous unit's ${lastSeq}`,
      );
    } else {
      lastSeq = unit.seq;
    }

    if (!KEBAB.test(unit.id ?? "")) {
      problems.push(`${label}: id must be lower-case kebab`);
    } else if (ids.has(unit.id)) {
      problems.push(`${label}: id is repeated`);
    }
    ids.add(unit.id);

    for (const problem of unitProblems(unit, files)) {
      problems.push(`${label}: ${problem}`);
    }
  });

  return problems;
}

/**
 * @param {unknown} window
 * @returns {string[]}
 */
function windowProblems(window) {
  if (!isObject(window)) return ["window must be an object"];
  const problems = [];

  let validZone = isText(window.timezone);
  if (validZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: window.timezone });
    } catch {
      validZone = false;
    }
  }
  if (!validZone) {
    problems.push(
      `window: timezone ${JSON.stringify(window.timezone)} is not an IANA time zone`,
    );
  }

  if (!Array.isArray(window.slots) || window.slots.length === 0) {
    problems.push("window: slots must list at least one slot");
    return problems;
  }

  window.slots.forEach((slot, index) => {
    const label = `window: slot #${index + 1}`;
    if (!isObject(slot)) {
      problems.push(`${label} is not an object`);
      return;
    }
    const { days, from, to } = slot;
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      new Set(days).size !== days.length ||
      !days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    ) {
      problems.push(
        `${label} days must be whole numbers 1–7 (1 = Monday) without repeats`,
      );
    }
    if (!TIME.test(from ?? "") || !TIME.test(to ?? "") || from >= to) {
      problems.push(`${label} needs HH:MM from and to, with from before to`);
    }
  });

  return problems;
}

/**
 * @param {unknown} origin
 * @returns {boolean}
 */
function isHttpsOrigin(origin) {
  if (typeof origin !== "string") return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.origin === origin;
  } catch {
    return false;
  }
}

/**
 * Every problem with a project list, as one reason per line. Empty when valid.
 * @param {unknown} data
 * @returns {string[]}
 */
export function checkProjects(data) {
  if (!isObject(data) || !Array.isArray(data.projects)) {
    return ['the project list needs a "projects" list'];
  }

  const names = new Set();
  const refs = new Set();
  /** @type {string[]} */
  const problems = [];

  data.projects.forEach((project, index) => {
    if (!isObject(project)) {
      problems.push(`project #${index + 1} is not an object`);
      return;
    }
    const label = isText(project.name)
      ? `project ${JSON.stringify(project.name)}`
      : `project #${index + 1}`;
    const add = (/** @type {string} */ problem) =>
      problems.push(`${label}: ${problem}`);

    if (!KEBAB.test(project.name ?? "")) add("name must be lower-case kebab");
    else if (names.has(project.name)) add("name is repeated");
    names.add(project.name);

    if (!REF.test(project.ref ?? "")) add("ref must be 20 lower-case letters");
    else if (refs.has(project.ref)) add(`ref ${project.ref} is repeated`);
    refs.add(project.ref);

    if (!PROJECT_TYPES.includes(project.type)) {
      add(
        `type ${JSON.stringify(project.type)} is not one of ${PROJECT_TYPES.join(", ")}`,
      );
    }
    if (!isText(project.site)) add("site must name the Vercel project");
    if (!isHttpsOrigin(project.origin)) {
      add(`origin ${JSON.stringify(project.origin)} must be an https origin`);
    }
    if (typeof project.holdsRealData !== "boolean") {
      add("holdsRealData must be true or false");
    }

    if (project.window == null) {
      if (project.holdsRealData === true) {
        add("holds real data but has no delivery window");
      }
    } else {
      for (const problem of windowProblems(project.window)) add(problem);
    }
  });

  return problems;
}

/**
 * @param {string} label
 * @param {string[]} problems
 */
const refusal = (label, problems) =>
  new Error(
    `${label} is refused:\n${problems.map((p) => `- ${p}`).join("\n")}`,
  );

/**
 * @param {string} root
 * @param {string} label
 * @returns {unknown}
 */
function readJson(root, label) {
  try {
    return JSON.parse(readFileSync(join(root, label), "utf8"));
  } catch (err) {
    throw refusal(label, [`cannot be read as JSON: ${err.message}`]);
  }
}

/**
 * Reads and checks the committed manifest; throws with every reason when it
 * is malformed.
 * @param {string} [root] the repository root
 * @returns {Manifest}
 */
export function loadManifest(root = REPO_ROOT) {
  const data = readJson(root, MANIFEST_PATH);
  const schemaFiles = readdirSync(join(root, "supabase", "schema")).filter(
    (name) => name.endsWith(".sql"),
  );
  const problems = checkManifest(data, schemaFiles);
  if (problems.length > 0) throw refusal(MANIFEST_PATH, problems);
  return /** @type {Manifest} */ (data);
}

/**
 * Reads and checks the committed project list; throws with every reason when
 * it is malformed.
 * @param {string} [root] the repository root
 * @returns {ProjectList}
 */
export function loadProjects(root = REPO_ROOT) {
  const data = readJson(root, PROJECTS_PATH);
  const problems = checkProjects(data);
  if (problems.length > 0) throw refusal(PROJECTS_PATH, problems);
  return /** @type {ProjectList} */ (data);
}

/**
 * The sequence a build at this commit requires: the manifest's highest.
 * @param {Manifest} manifest
 * @returns {number}
 */
export function requiredSequence(manifest) {
  return manifest.units.reduce(
    (highest, unit) => Math.max(highest, unit.seq),
    0,
  );
}

/**
 * The units a project of `type` still needs once it holds `afterSeq`, in order.
 * @param {Manifest} manifest
 * @param {ProjectType} type
 * @param {number} afterSeq
 * @returns {Unit[]}
 */
export function unitsFor(manifest, type, afterSeq) {
  return manifest.units.filter(
    (unit) => unit.seq > afterSeq && unit.appliesTo.includes(type),
  );
}
