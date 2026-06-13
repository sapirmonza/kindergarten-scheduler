import { Router } from "express";
import db from "../db";
import { toMin } from "../services/scheduler";

const router = Router();

// Month attribution is by the week's start_date (Sunday). A week belongs to the month of its Sunday.

// GET /api/reports/changes?month=YYYY-MM  -> post-approval change log for that month
router.get("/changes", (req, res) => {
  const month = String(req.query.month || "");
  const rows = db
    .prepare(
      `SELECT c.*, w.start_date AS week_start
       FROM schedule_changes c JOIN weeks w ON c.week_id = w.id
       WHERE substr(w.start_date, 1, 7) = ?
       ORDER BY c.date, c.id`
    )
    .all(month);
  res.json(rows);
});

// POST /api/reports/changes/delete  body: { ids?: number[] } or { month?: "YYYY-MM" }
// Delete specific change-log records (ids) or clear all records for a month.
router.post("/changes/delete", (req, res) => {
  const { ids, month } = req.body || {};
  if (Array.isArray(ids) && ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM schedule_changes WHERE id IN (${placeholders})`).run(...ids.map(Number));
  } else if (month) {
    db.prepare(
      "DELETE FROM schedule_changes WHERE week_id IN (SELECT id FROM weeks WHERE substr(start_date,1,7)=?)"
    ).run(String(month));
  }
  res.json({ ok: true });
});

// a shift can overlap the morning block (08:00-13:00) and/or the afternoon block (13:00-16:00).
// A whole-day shift (e.g. 07:30-16:15) overlaps BOTH.
const overlapsMorning = (start: string, end: string) => toMin(start) < 13 * 60 && toMin(end) > 8 * 60;
const overlapsAfternoon = (start: string, end: string) => toMin(start) < 16 * 60 && toMin(end) > 13 * 60;
const shiftKey = (date: string, start: string, end: string) => `${date}|${start}|${end}`;

// GET /api/reports/managers?month=YYYY-MM
// Per manager, compared to the APPROVED BASELINE of each week:
//   extra     = shifts ADDED after approval (a whole-day add counts as both morning + afternoon)
//   shortfall = baseline shifts REMOVED after approval
// Plus the full list of shifts she actually worked, with the added ones flagged.
router.get("/managers", (req, res) => {
  const month = String(req.query.month || "");
  // only weeks that actually have a schedule (assignments) — empty/unplanned weeks are irrelevant
  const weeks = db
    .prepare(
      `SELECT w.* FROM weeks w
       WHERE substr(w.start_date, 1, 7) = ?
         AND EXISTS (SELECT 1 FROM assignments a WHERE a.week_id = w.id)
       ORDER BY w.start_date`
    )
    .all(month) as any[];
  const managers = db.prepare("SELECT * FROM staff WHERE type='manager' ORDER BY name").all() as any[];

  const distinctDates = (rows: { date: string }[]) => new Set(rows.map((r) => r.date)).size;

  const result = managers.map((m) => {
    const totals = {
      workedMorning: 0,
      workedAfternoon: 0,
      extraMorning: 0,
      shortMorning: 0,
      extraAfternoon: 0,
      shortAfternoon: 0,
    };
    const weekReports = weeks.map((w) => {
      const current = (
        db.prepare("SELECT date, start_time, end_time FROM assignments WHERE week_id=? AND staff_id=?").all(w.id, m.id) as any[]
      ).map((a) => ({ date: a.date, start: a.start_time, end: a.end_time }));

      // baseline (approved plan) for this manager; if none yet (draft), treat current as baseline
      const baselineAll: any[] = w.baseline ? JSON.parse(w.baseline) : null;
      const baseline = baselineAll
        ? baselineAll.filter((b) => b.staff_id === m.id).map((b) => ({ date: b.date, start: b.start_time, end: b.end_time }))
        : current;

      const baseKeys = new Set(baseline.map((b) => shiftKey(b.date, b.start, b.end)));
      const added = current.filter((c) => !baseKeys.has(shiftKey(c.date, c.start, c.end)));

      // worked vs quota, NET (so an addition offset by a removal balances out to 0)
      const morningCount = distinctDates(current.filter((c) => overlapsMorning(c.start, c.end)));
      const afternoonCount = distinctDates(current.filter((c) => overlapsAfternoon(c.start, c.end)));
      const extraMorning = Math.max(0, morningCount - m.morning_quota);
      const shortMorning = Math.max(0, m.morning_quota - morningCount);
      const extraAfternoon = Math.max(0, afternoonCount - m.afternoon_quota);
      const shortAfternoon = Math.max(0, m.afternoon_quota - afternoonCount);

      totals.workedMorning += morningCount;
      totals.workedAfternoon += afternoonCount;
      totals.extraMorning += extraMorning;
      totals.extraAfternoon += extraAfternoon;
      totals.shortMorning += shortMorning;
      totals.shortAfternoon += shortAfternoon;

      // which shifts to flag as "extra": only the ADDED ones that push her over quota.
      // Take the last `extra` added shifts per slot (so a replacement add isn't flagged when balanced).
      const lastKeys = (arr: any[], n: number) =>
        new Set(
          arr
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(arr.length - n)
            .map((x) => shiftKey(x.date, x.start, x.end))
        );
      const extraMorningKeys = lastKeys(added.filter((c) => overlapsMorning(c.start, c.end)), extraMorning);
      const extraAfternoonKeys = lastKeys(added.filter((c) => overlapsAfternoon(c.start, c.end)), extraAfternoon);

      const shifts = current
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
        .map((c) => {
          const k = shiftKey(c.date, c.start, c.end);
          return {
            date: c.date,
            start: c.start,
            end: c.end,
            morning: overlapsMorning(c.start, c.end),
            afternoon: overlapsAfternoon(c.start, c.end),
            isExtra: extraMorningKeys.has(k) || extraAfternoonKeys.has(k),
          };
        });

      return {
        start_date: w.start_date,
        morningCount,
        afternoonCount,
        extraMorning,
        shortMorning,
        extraAfternoon,
        shortAfternoon,
        shifts,
      };
    });
    return {
      id: m.id,
      name: m.name,
      morning_quota: m.morning_quota,
      afternoon_quota: m.afternoon_quota,
      totals,
      weeks: weekReports,
    };
  });

  res.json({ month, weeks: weeks.map((w) => w.start_date), managers: result });
});

export default router;
