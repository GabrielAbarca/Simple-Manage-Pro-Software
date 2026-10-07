import { describe, it, expect, afterEach } from "vitest";
import { upcomingEvents } from "../src/js/upcomingEvents.js";

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const ev = (title, start_date, end_date = null) => ({
  title,
  start_date,
  end_date,
});

describe("upcomingEvents", () => {
  const events = [
    ev("ended yesterday", "2026-10-01", "2026-10-06"),
    ev("ends today", "2026-10-01", "2026-10-07"),
    ev("today only", "2026-10-07"),
    ev("ongoing", "2026-10-05", "2026-10-09"),
    ev("later", "2026-10-20"),
    ev("past single day", "2026-10-06"),
  ];

  it("keeps events that end today or later, in the order given", () => {
    const now = new Date(2026, 9, 7, 12, 0);
    expect(upcomingEvents(events, now).map((e) => e.title)).toEqual([
      "ends today",
      "today only",
      "ongoing",
      "later",
    ]);
  });

  it("judges today by the local date, not the UTC one", () => {
    process.env.TZ = "America/Costa_Rica";
    // 23:30 on 7 October in Costa Rica is already 8 October in UTC.
    const now = new Date("2026-10-08T05:30:00Z");
    expect(upcomingEvents(events, now).map((e) => e.title)).toContain(
      "today only",
    );
  });

  it("tolerates a missing list", () => {
    expect(upcomingEvents(undefined)).toEqual([]);
  });
});
