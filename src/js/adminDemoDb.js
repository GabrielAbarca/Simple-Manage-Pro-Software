// ─────────────────────────────────────────────────────────────────
//  adminDemoDb.js — demo-mode write sandbox for the admin console.
//
//  Wraps a real Gateway (adminData.js) so every write lands in an
//  in-memory, per-session delta store instead of Supabase, while reads
//  keep hitting the real (read-only) backend and get the session's
//  deltas overlaid on the way out. The console's write→re-fetch flows
//  then render local changes as if they persisted; a refresh discards
//  the deltas and restores pristine demo data.
//
//  This module NEVER writes to Supabase — it only records deltas. The
//  server-side RLS lock remains the backstop for anyone bypassing the UI.
//
//  Because the admin data layer reads one flat table at a time, the
//  overlay is fully generic: one delta store per table, no per-method
//  bespoke logic (unlike the teacher console's demoDb.js).
// ─────────────────────────────────────────────────────────────────

/**
 * @typedef {import("./adminData.js").Gateway} Gateway
 * @typedef {import("./adminData.js").SelectOpts} SelectOpts
 */

/**
 * @param {Gateway} realGateway the passthrough (Supabase) gateway for reads
 * @param {{ onWrite?: () => void }} [opts]
 * @returns {Gateway}
 */
export function createDemoGateway(realGateway, { onWrite = () => {} } = {}) {
  // Local rows get negative ids: they can never collide with real rows
  // (positive integers) and are easy to keep out of any server query.
  let nextLocalId = -1;
  const newId = () => nextLocalId--;

  /** @type {Map<string, { inserts: any[], updates: Map<number, any>, deletes: Set<number> }>} */
  const deltas = new Map();
  const deltaFor = (/** @type {string} */ table) => {
    let d = deltas.get(table);
    if (!d) {
      d = { inserts: [], updates: new Map(), deletes: new Set() };
      deltas.set(table, d);
    }
    return d;
  };

  /** Does a row satisfy a select's match / inList / between filters? */
  function rowMatches(/** @type {any} */ row, /** @type {SelectOpts} */ opts) {
    if (opts.match) {
      for (const [col, val] of Object.entries(opts.match)) {
        if (String(row[col]) !== String(val)) return false;
      }
    }
    if (opts.inList) {
      const set = new Set(opts.inList.values.map(String));
      if (!set.has(String(row[opts.inList.column]))) return false;
    }
    if (opts.between) {
      const { column, from, to } = opts.between;
      const value = row[column];
      if (value == null) return false;
      if (from != null && String(value) < from) return false;
      if (to != null && String(value) > to) return false;
    }
    return true;
  }

  /** Comparator mirroring the gateway's single-column .order() clause. */
  function makeComparator(/** @type {SelectOpts["order"]} */ order) {
    if (!order) return () => 0;
    const dir = order.ascending === false ? -1 : 1;
    const col = order.column;
    return (/** @type {any} */ a, /** @type {any} */ b) => {
      const av = a[col];
      const bv = b[col];
      if (av == null && bv == null) return 0;
      if (av == null) return -dir;
      if (bv == null) return dir;
      const an = Number(av);
      const bn = Number(bv);
      const numeric =
        !Number.isNaN(an) && !Number.isNaN(bn) && av !== "" && bv !== "";
      const cmp = numeric ? an - bn : String(av).localeCompare(String(bv));
      return cmp * dir;
    };
  }

  /** @type {Gateway["select"]} */
  async function select(table, opts = {}) {
    // Whole rows, whatever `columns` asks for: the overlay below re-filters
    // and patches by columns the narrowed read may not include.
    const { columns: _columns, ...serverOpts } = opts;
    const serverRows = await realGateway.select(table, serverOpts);
    const delta = deltas.get(table);

    let rows = serverRows.map((r) => ({ ...r }));
    if (delta) {
      rows = rows
        .filter((r) => !delta.deletes.has(r.id))
        .map((r) => {
          const patch = delta.updates.get(r.id);
          return patch ? { ...r, ...patch } : r;
        });
      rows.push(...delta.inserts.map((r) => ({ ...r })));
    }

    // Re-apply the read's filters (an update may have changed a filtered
    // column) and its ordering across the merged set.
    rows = rows.filter((r) => rowMatches(r, opts));
    if (opts.order) rows.sort(makeComparator(opts.order));
    return rows;
  }

  return {
    select,

    async count(table, opts = {}) {
      const delta = deltas.get(table);
      const touched =
        delta &&
        (delta.inserts.length || delta.updates.size || delta.deletes.size);
      if (!touched) return realGateway.count(table, opts);
      // Read the table unfiltered: a row the server would filter out can
      // match once a local update applies.
      return (await select(table)).filter((r) => rowMatches(r, opts)).length;
    },

    async insert(table, row) {
      const created = { ...row, id: newId() };
      deltaFor(table).inserts.push(created);
      onWrite();
      return { ...created };
    },

    async insertMany(table, rows) {
      const delta = deltaFor(table);
      const created = rows.map((row) => ({ ...row, id: newId() }));
      delta.inserts.push(...created);
      if (created.length) onWrite();
      return created.map((r) => ({ ...r }));
    },

    async update(table, id, patch) {
      const delta = deltaFor(table);
      const local = delta.inserts.find((r) => r.id === id);
      if (local) {
        Object.assign(local, patch);
      } else {
        delta.updates.set(id, { ...(delta.updates.get(id) ?? {}), ...patch });
      }
      onWrite();
    },

    async remove(table, id) {
      const delta = deltaFor(table);
      const at = delta.inserts.findIndex((r) => r.id === id);
      if (at >= 0) {
        delta.inserts.splice(at, 1);
      } else {
        delta.updates.delete(id);
        delta.deletes.add(id);
      }
      onWrite();
    },
  };
}
