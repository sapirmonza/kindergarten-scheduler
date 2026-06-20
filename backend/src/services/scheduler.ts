import db from "../db";
import { buildPlans, type OptInput, type OptDay, type OptRegular, type OptManager } from "./optimizer";

// ---------------------------------------------------------------------------
// Time & date helpers
// ---------------------------------------------------------------------------

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
export function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
// 0=Sunday ... 6=Saturday (UTC, to avoid timezone drift)
export function dow(iso: string): number {
  return new Date(iso + "T00:00:00Z").getUTCDay();
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

// Manager slot definitions (per the kindergarten's rules)
const MORNING_START = toMin("08:00"); // 480
const MORNING_END = toMin("13:00"); // 780
const AFTERNOON_START = toMin("13:00"); // 780
const AFTERNOON_END = toMin("16:00"); // 960

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Window = { start: number; end: number };
type Seg = { start_time: string; end_time: string; required_count: number };
type Placed = { staff_id: number; date: string; start: number; end: number };

export type CoverageSegment = {
  start: string;
  end: string;
  required: number;
  assigned: number;
  shortage: number;
  surplus: number;
  staff: { id: number; name: string }[];
};
export type DayCoverage = {
  date: string;
  day_of_week: number;
  closed: boolean;
  segments: CoverageSegment[];
};

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadContext(weekId: number) {
  const week = db.prepare("SELECT * FROM weeks WHERE id=?").get(weekId) as any;
  if (!week) throw new Error("week not found");

  const reqs = db.prepare("SELECT * FROM coverage_requirements").all() as any[];
  const segsByType: Record<string, Seg[]> = { weekday: [], friday: [] };
  for (const r of reqs) segsByType[r.day_type].push(r);
  for (const t of Object.keys(segsByType)) segsByType[t].sort((a, b) => toMin(a.start_time) - toMin(b.start_time));

  const staff = db.prepare("SELECT * FROM staff WHERE active=1").all() as any[];
  const avail = db.prepare("SELECT * FROM staff_availability").all() as any[];
  const availByStaff: Record<number, any[]> = {};
  for (const a of avail) (availByStaff[a.staff_id] ||= []).push(a);

  const constraints = db.prepare("SELECT * FROM constraints WHERE week_id=?").all(weekId) as any[];
  const closures = db.prepare("SELECT * FROM closures WHERE week_id=?").all(weekId) as any[];

  return { week, segsByType, staff, availByStaff, constraints, closures };
}

type Ctx = ReturnType<typeof loadContext>;

// Open hours for a day type, derived from the coverage requirements (adapts to edits).
function openHours(ctx: Ctx, dayType: string): Window {
  const segs = ctx.segsByType[dayType];
  if (!segs.length) return { start: 0, end: 0 };
  return {
    start: Math.min(...segs.map((s) => toMin(s.start_time))),
    end: Math.max(...segs.map((s) => toMin(s.end_time))),
  };
}

// Is the whole day closed?
function fullDayClosure(ctx: Ctx, date: string): boolean {
  return ctx.closures.some((c) => c.date === date && !c.start_time && !c.end_time);
}

// Subtract a set of [start,end] windows from a base list of windows.
function subtract(windows: Window[], cuts: Window[]): Window[] {
  let result = windows;
  for (const cut of cuts) {
    const next: Window[] = [];
    for (const w of result) {
      if (cut.end <= w.start || cut.start >= w.end) {
        next.push(w); // no overlap
      } else {
        if (cut.start > w.start) next.push({ start: w.start, end: cut.start });
        if (cut.end < w.end) next.push({ start: cut.end, end: w.end });
      }
    }
    result = next;
  }
  return result.filter((w) => w.end > w.start);
}

function intersect(a: Window, b: Window): Window | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

// Biweekly Friday parity: is `friday` an "on" week relative to the anchor?
function biweeklyOn(anchor: string | null, date: string): boolean {
  if (!anchor) return true; // no anchor set -> assume on
  // Compare by WEEK (normalize both to their week's Sunday) so parity is correct regardless of
  // which weekday the anchor falls on — the user may pick any day within "the week she works".
  const sundayOfISO = (iso: string) => addDays(iso, -dow(iso));
  const weeks = Math.round(daysBetween(sundayOfISO(anchor), sundayOfISO(date)) / 7);
  return weeks % 2 === 0;
}

// ---------------------------------------------------------------------------
// Per-staff availability for a given date (as time windows in minutes)
// ---------------------------------------------------------------------------

function staffWindowsForDay(ctx: Ctx, staff: any, date: string, dayType: string): Window[] {
  if (fullDayClosure(ctx, date)) return [];
  const open = openHours(ctx, dayType);
  const d = dow(date);
  let base: Window[] = [];

  if (d === 5) {
    // Friday — the friday_mode rules apply
    switch (staff.friday_mode) {
      case "none":
        return [];
      case "biweekly":
        if (!biweeklyOn(staff.friday_anchor, date)) return [];
        base = [{ ...open }];
        break;
      case "morning":
        base = [{ ...open }]; // Friday is a single morning shift (07:30-12:00)
        break;
      default: // 'regular'
        if (staff.type === "manager") base = [{ ...open }];
        else base = templateWindows(ctx, staff, d, open, date);
    }
  } else {
    // Sun-Thu
    if (staff.type === "manager") base = [{ ...open }];
    else base = templateWindows(ctx, staff, d, open, date);
  }

  const myConstraints = ctx.constraints.filter((c) => c.staff_id === staff.id && c.date === date);

  // 'available' constraints ADD extra availability (committed) for this date.
  const availableAdds: Window[] = myConstraints
    .filter((c) => c.direction === "available")
    .map((c) => (c.start_time && c.end_time ? { start: toMin(c.start_time), end: toMin(c.end_time) } : { ...open }));
  base = mergeWindows([...base, ...availableAdds]);

  // partial closures on this date
  const partialClosures: Window[] = ctx.closures
    .filter((c) => c.date === date && c.start_time && c.end_time)
    .map((c) => ({ start: toMin(c.start_time), end: toMin(c.end_time) }));

  // only 'block' constraints REMOVE availability ('available'/'required' do not).
  const blocks = myConstraints.filter((c) => c.direction === "block");
  if (blocks.some((c) => !c.start_time && !c.end_time)) return []; // full-day block
  const partialBlocks: Window[] = blocks
    .filter((c) => c.start_time && c.end_time)
    .map((c) => ({ start: toMin(c.start_time), end: toMin(c.end_time) }));

  return subtract(base, [...partialClosures, ...partialBlocks]);
}

// Merge overlapping/adjacent windows into a minimal sorted set.
function mergeWindows(windows: Window[]): Window[] {
  const sorted = windows.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start);
  const out: Window[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else out.push({ ...w });
  }
  return out;
}

function templateWindows(ctx: Ctx, staff: any, dayOfWeek: number, open: Window, date: string): Window[] {
  const rows = (ctx.availByStaff[staff.id] || []).filter((a) => a.day_of_week === dayOfWeek);
  const out: Window[] = [];
  for (const r of rows) {
    // 'biweekly' day: include only on its "on" weeks (parity from anchor_date)
    if (r.frequency === "biweekly" && !biweeklyOn(r.anchor_date, date)) continue;
    const w = intersect({ start: toMin(r.start_time), end: toMin(r.end_time) }, open);
    if (w) out.push(w);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coverage counting
// ---------------------------------------------------------------------------

// Distinct staff whose placed shift fully covers [segStart, segEnd] on `date`.
function coveringStaff(placed: Placed[], date: string, segStart: number, segEnd: number): Set<number> {
  const ids = new Set<number>();
  for (const p of placed) {
    if (p.date === date && p.start <= segStart && p.end >= segEnd) ids.add(p.staff_id);
  }
  return ids;
}

// Worst (largest) shortage among segments inside [winStart, winEnd] on `date`.
function slotGap(segs: Seg[], placed: Placed[], date: string, winStart: number, winEnd: number): number {
  let gap = 0;
  for (const seg of segs) {
    const s = toMin(seg.start_time);
    const e = toMin(seg.end_time);
    if (s >= winStart && e <= winEnd) {
      const covered = coveringStaff(placed, date, s, e).size;
      gap = Math.max(gap, seg.required_count - covered);
    }
  }
  return gap;
}

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------

// Build the pure optimizer input from a week's DB context.
function buildOptInput(ctx: Ctx): OptInput {
  const startDate: string = ctx.week.start_date;
  const fridayMorningEnd = openHours(ctx, "friday").end;

  const days: OptDay[] = [];
  for (let offset = 0; offset <= 5; offset++) {
    const date = addDays(startDate, offset);
    if (fullDayClosure(ctx, date)) continue;
    const dayType = offset === 5 ? "friday" : "weekday";
    const segs = ctx.segsByType[dayType];
    if (!segs.length) continue;
    days.push({
      date,
      morningStart: MORNING_START,
      morningEnd: dayType === "friday" ? fridayMorningEnd : MORNING_END,
      afternoonStart: AFTERNOON_START,
      afternoonEnd: AFTERNOON_END,
      hasAfternoon: dayType === "weekday",
      morningPresence: true,
      segments: segs.map((s) => ({ start: toMin(s.start_time), end: toMin(s.end_time), required: s.required_count })),
    });
  }

  const dtype = (date: string): "weekday" | "friday" => (dow(date) === 5 ? "friday" : "weekday");
  const dayByDate = new Map(days.map((d) => [d.date, d]));

  // --- "required" constraints -> forced pre-placed shifts (strongest priority) ---
  const forced: OptInput["forced"] = [];
  const forcedByStaff = new Map<number, { date: string; start: number; end: number }[]>();
  for (const c of ctx.constraints) {
    if (c.direction !== "required") continue;
    const day = dayByDate.get(c.date);
    if (!day) continue; // closed / non-working day
    const staffRow = ctx.staff.find((s) => s.id === c.staff_id);
    if (!staffRow) continue;
    const openStart = Math.min(...day.segments.map((s) => s.start));
    const openEnd = Math.max(...day.segments.map((s) => s.end));
    const start = Math.max(c.start_time ? toMin(c.start_time) : openStart, openStart);
    const end = Math.min(c.end_time ? toMin(c.end_time) : openEnd, openEnd);
    if (end <= start) continue;
    forced.push({ staff_id: c.staff_id, date: c.date, start, end, isManager: staffRow.type === "manager" });
    (forcedByStaff.get(c.staff_id) ?? forcedByStaff.set(c.staff_id, []).get(c.staff_id)!).push({ date: c.date, start, end });
  }

  const regulars: OptRegular[] = [];
  for (const r of ctx.staff.filter((s) => s.type === "regular")) {
    const allAvail: { date: string; start: number; end: number }[] = [];
    for (const d of days) {
      const windows = staffWindowsForDay(ctx, r, d.date, dtype(d.date));
      if (!windows.length) continue;
      const w = windows.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a)); // longest window
      allAvail.push({ date: d.date, start: w.start, end: w.end });
    }
    const forcedDates = new Set((forcedByStaff.get(r.id) || []).map((f) => f.date));
    const avail = allAvail.filter((a) => !forcedDates.has(a.date)); // forced days are guaranteed, not chosen
    if (!avail.length && !forcedDates.size) continue;
    const baseTarget = r.days_per_week != null ? r.days_per_week : allAvail.length;
    const forcedWithinAvail = allAvail.filter((a) => forcedDates.has(a.date)).length;
    const target = Math.max(0, baseTarget - forcedWithinAvail);
    regulars.push({ id: r.id, target, avail });
  }

  const managers: OptManager[] = [];
  for (const m of ctx.staff.filter((s) => s.type === "manager")) {
    const myForced = forcedByStaff.get(m.id) || [];
    const forcedMorn = new Set<string>();
    const forcedAft = new Set<string>();
    for (const f of myForced) {
      const day = dayByDate.get(f.date);
      if (!day) continue;
      if (f.start < day.morningEnd && f.end > day.morningStart) forcedMorn.add(f.date);
      if (day.hasAfternoon && f.start < day.afternoonEnd && f.end > day.afternoonStart) forcedAft.add(f.date);
    }
    const availMornings: string[] = [];
    const availAfternoons: string[] = [];
    for (const d of days) {
      const windows = staffWindowsForDay(ctx, m, d.date, dtype(d.date));
      if (!forcedMorn.has(d.date) && windows.some((w) => w.start <= d.morningStart && w.end >= d.morningEnd))
        availMornings.push(d.date);
      if (
        d.hasAfternoon &&
        !forcedAft.has(d.date) &&
        windows.some((w) => w.start <= d.afternoonStart && w.end >= d.afternoonEnd)
      )
        availAfternoons.push(d.date);
    }
    managers.push({
      id: m.id,
      morningQuota: Math.max(0, m.morning_quota - forcedMorn.size),
      afternoonQuota: Math.max(0, m.afternoon_quota - forcedAft.size),
      availMornings,
      availAfternoons,
    });
  }

  return { days, regulars, managers, forced };
}

export type GeneratedPlan = {
  shortage: number;
  surplus: number;
  missingPresence: number;
  shifts: { staff_id: number; date: string; start_time: string; end_time: string }[];
  // where the shortages are (for comparing plans)
  shortages: { date: string; day_of_week: number; start: string; end: string; shortage: number }[];
  // manager distribution (the main thing that differs between equally-scored plans)
  managers: { name: string; date: string; day_of_week: number; slot: "morning" | "afternoon" }[];
};

// Compute several candidate plans (no persistence) for the user to compare/choose.
export function computePlans(weekId: number, count = 3): GeneratedPlan[] {
  const ctx = loadContext(weekId);
  const input = buildOptInput(ctx);
  const nameById = new Map<number, string>(ctx.staff.map((s) => [s.id, s.name]));
  const managerIds = new Set(ctx.staff.filter((s) => s.type === "manager").map((s) => s.id));

  return buildPlans(input, count, 60).map((p) => {
    // where are the shortages (per segment) under this plan
    const shortages: GeneratedPlan["shortages"] = [];
    for (const d of input.days) {
      for (const seg of d.segments) {
        const cov = new Set(
          p.shifts.filter((s) => s.date === d.date && s.start <= seg.start && s.end >= seg.end).map((s) => s.staff_id)
        ).size;
        const short = Math.max(0, seg.required - cov);
        if (short > 0)
          shortages.push({ date: d.date, day_of_week: dow(d.date), start: toHHMM(seg.start), end: toHHMM(seg.end), shortage: short });
      }
    }
    // manager distribution (the main thing that varies between equally-scored plans)
    const managers: GeneratedPlan["managers"] = p.shifts
      .filter((s) => managerIds.has(s.staff_id))
      .map((s) => ({
        name: nameById.get(s.staff_id) || `#${s.staff_id}`,
        date: s.date,
        day_of_week: dow(s.date),
        slot: s.start < 13 * 60 ? "morning" : "afternoon",
      }));

    return {
      shortage: p.shortage,
      surplus: p.surplus,
      missingPresence: p.missingPresence,
      shifts: p.shifts.map((s) => ({
        staff_id: s.staff_id,
        date: s.date,
        start_time: toHHMM(s.start),
        end_time: toHHMM(s.end),
      })),
      shortages,
      managers,
    };
  });
}

// Persist a chosen plan's shifts (wipes the week first; resets to draft).
export function applyPlan(weekId: number, shifts: GeneratedPlan["shifts"]): void {
  db.prepare("DELETE FROM assignments WHERE week_id=?").run(weekId);
  const ins = db.prepare(
    "INSERT INTO assignments (week_id, staff_id, date, start_time, end_time, source) VALUES (?,?,?,?,?,'auto')"
  );
  const tx = db.transaction(() => {
    for (const s of shifts) ins.run(weekId, s.staff_id, s.date, s.start_time, s.end_time);
  });
  tx();
  db.prepare("UPDATE weeks SET status='draft' WHERE id=?").run(weekId);
}

// One-shot generate: apply the single best plan.
export function generateWeek(weekId: number): void {
  const plans = computePlans(weekId, 1);
  applyPlan(weekId, plans[0]?.shifts ?? []);
}

// ---------------------------------------------------------------------------
// Coverage analysis (required vs assigned per segment, with shortages)
// ---------------------------------------------------------------------------

export function analyzeCoverage(weekId: number): DayCoverage[] {
  const ctx = loadContext(weekId);
  const startDate: string = ctx.week.start_date;
  const assignments = db.prepare("SELECT * FROM assignments WHERE week_id=?").all(weekId) as any[];
  const placed: Placed[] = assignments.map((a) => ({
    staff_id: a.staff_id,
    date: a.date,
    start: toMin(a.start_time),
    end: toMin(a.end_time),
  }));
  const staffName: Record<number, string> = {};
  for (const s of ctx.staff) staffName[s.id] = s.name;
  // include names of inactive staff that may still be assigned
  for (const a of assignments)
    if (!staffName[a.staff_id]) {
      const s = db.prepare("SELECT name FROM staff WHERE id=?").get(a.staff_id) as any;
      if (s) staffName[a.staff_id] = s.name;
    }

  const days: DayCoverage[] = [];
  for (let offset = 0; offset <= 5; offset++) {
    const date = addDays(startDate, offset);
    const d = dow(date);
    const dayType = offset === 5 ? "friday" : "weekday";
    const closed = fullDayClosure(ctx, date);
    const segs = ctx.segsByType[dayType] || [];

    const segments: CoverageSegment[] = segs.map((seg) => {
      const s = toMin(seg.start_time);
      const e = toMin(seg.end_time);
      const ids = closed ? new Set<number>() : coveringStaff(placed, date, s, e);
      return {
        start: seg.start_time,
        end: seg.end_time,
        required: seg.required_count,
        assigned: ids.size,
        // a closed day needs no staff -> neither shortage nor surplus
        shortage: closed ? 0 : Math.max(0, seg.required_count - ids.size),
        surplus: closed ? 0 : Math.max(0, ids.size - seg.required_count),
        staff: [...ids].map((id) => ({ id, name: staffName[id] || "?" })),
      };
    });

    days.push({ date, day_of_week: d, closed, segments });
  }
  return days;
}

// ---------------------------------------------------------------------------
// Replacement suggestions for a specific shortage
// ---------------------------------------------------------------------------

export type Replacement = {
  staff_id: number;
  name: string;
  type: string;
  suggested_start: string;
  suggested_end: string;
  reason: string;
};

export function suggestReplacements(
  weekId: number,
  date: string,
  segStart: string,
  segEnd: string
): Replacement[] {
  const ctx = loadContext(weekId);
  const d = dow(date);
  const start = toMin(segStart);
  const end = toMin(segEnd);

  const assignments = db.prepare("SELECT * FROM assignments WHERE week_id=? AND date=?").all(weekId, date) as any[];
  const assignedIds = new Set<number>(assignments.map((a) => a.staff_id));
  // staff already covering this exact segment (no point suggesting them)
  const coversSegment = new Set<number>(
    assignments.filter((a) => toMin(a.start_time) <= start && toMin(a.end_time) >= end).map((a) => a.staff_id)
  );

  const out: (Replacement & { _rank: number })[] = [];
  for (const s of ctx.staff) {
    // only 'block' constraints that day block a candidate ('available'/'required' do not)
    const myBlocks = ctx.constraints.filter(
      (c) => c.staff_id === s.id && c.date === date && c.direction === "block"
    );
    if (myBlocks.some((c) => !c.start_time && !c.end_time)) continue; // full-day off
    const blockedWindow = myBlocks.some(
      (c) => c.start_time && c.end_time && toMin(c.start_time) < end && toMin(c.end_time) > start
    );
    if (blockedWindow) continue;

    // explicit positive availability for this date/window overrides the Friday rules below
    const hasAvail = ctx.constraints.some(
      (c) =>
        c.staff_id === s.id &&
        c.date === date &&
        c.direction === "available" &&
        (!c.start_time || (toMin(c.start_time) <= start && toMin(c.end_time) >= end))
    );

    // Friday rules (skipped if she was explicitly marked available this week)
    if (d === 5 && !hasAvail) {
      if (s.friday_mode === "none") continue;
      if (s.friday_mode === "biweekly" && !biweeklyOn(s.friday_anchor, date)) continue;
    }

    if (s.type === "manager") {
      // Managers are a wildcard ("ג'וקר"): always offered to fill a gap, even beyond their
      // quota or on a day they already work — but ranked LAST, after every free regular.
      if (coversSegment.has(s.id)) continue; // already covers this slot
      const reason = assignedIds.has(s.id)
        ? "מנהלת (ג'וקר) — תוכל להרחיב מעבר למכסה"
        : "מנהלת (ג'וקר) — פנויה למילוי חוסר";
      out.push({ staff_id: s.id, name: s.name, type: s.type, suggested_start: segStart, suggested_end: segEnd, reason, _rank: 9 });
      continue;
    }

    // Regulars: only those NOT already working that day (a true "call someone in").
    if (assignedIds.has(s.id)) continue;

    const templateRows = (ctx.availByStaff[s.id] || []).filter((a) => a.day_of_week === d);
    const worksThisDay = templateRows.length > 0;
    const hoursMatch = templateRows.some((r) => toMin(r.start_time) <= start && toMin(r.end_time) >= end);

    let reason = "פנויה ביום זה";
    let rank = 3;
    if (hoursMatch) {
      reason = "עובדת בדרך כלל ביום ובשעות אלו";
      rank = 1;
    } else if (worksThisDay) {
      reason = "עובדת בדרך כלל ביום זה";
      rank = 2;
    }
    out.push({ staff_id: s.id, name: s.name, type: s.type, suggested_start: segStart, suggested_end: segEnd, reason, _rank: rank });
  }

  out.sort((a, b) => a._rank - b._rank || a.name.localeCompare(b.name, "he"));
  return out.map(({ _rank, ...r }) => r);
}
