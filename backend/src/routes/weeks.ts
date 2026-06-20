import { Router } from "express";
import db from "../db";
import { generateWeek, analyzeCoverage, suggestReplacements, computePlans, applyPlan } from "../services/scheduler";

const router = Router();

// GET /api/weeks -> list weeks (newest first)
router.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM weeks ORDER BY start_date DESC").all());
});

// POST /api/weeks { start_date } -> create (or return existing)
router.post("/", (req, res) => {
  const start_date = String(req.body.start_date);
  const existing = db.prepare("SELECT * FROM weeks WHERE start_date=?").get(start_date) as any;
  if (existing) return res.json(existing);
  const info = db.prepare("INSERT INTO weeks (start_date) VALUES (?)").run(start_date);
  res.json(db.prepare("SELECT * FROM weeks WHERE id=?").get(info.lastInsertRowid));
});

// DELETE /api/weeks/:id
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM weeks WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

// GET /api/weeks/:id -> full week bundle
router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const week = db.prepare("SELECT * FROM weeks WHERE id=?").get(id);
  if (!week) return res.status(404).json({ error: "not found" });
  res.json({
    week,
    constraints: db.prepare("SELECT * FROM constraints WHERE week_id=? ORDER BY date").all(id),
    closures: db.prepare("SELECT * FROM closures WHERE week_id=? ORDER BY date").all(id),
    assignments: db
      .prepare("SELECT * FROM assignments WHERE week_id=? ORDER BY date, start_time").all(id),
    notes: db.prepare("SELECT * FROM day_notes WHERE week_id=? ORDER BY date, id").all(id),
    coverage: analyzeCoverage(id),
  });
});

// --- constraints ---
router.post("/:id/constraints", (req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const direction = ["available", "required"].includes(b.direction) ? b.direction : "block";
  const info = db
    .prepare(
      "INSERT INTO constraints (week_id, staff_id, date, direction, start_time, end_time, note) VALUES (?,?,?,?,?,?,?)"
    )
    .run(id, b.staff_id, b.date, direction, b.start_time || null, b.end_time || null, b.note || null);
  res.json({ id: info.lastInsertRowid });
});
router.delete("/:id/constraints/:cid", (req, res) => {
  db.prepare("DELETE FROM constraints WHERE id=?").run(Number(req.params.cid));
  res.json({ ok: true });
});

// --- closures ---
router.post("/:id/closures", (req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const info = db
    .prepare("INSERT INTO closures (week_id, date, start_time, end_time, reason) VALUES (?,?,?,?,?)")
    .run(id, b.date, b.start_time || null, b.end_time || null, b.reason || null);
  res.json({ id: info.lastInsertRowid });
});
router.delete("/:id/closures/:cid", (req, res) => {
  db.prepare("DELETE FROM closures WHERE id=?").run(Number(req.params.cid));
  res.json({ ok: true });
});

// --- generate: apply the single best plan (regenerating reverts to draft) ---
router.post("/:id/generate", (req, res) => {
  const id = Number(req.params.id);
  generateWeek(id);
  res.json({ ok: true, coverage: analyzeCoverage(id) });
});

// --- compute several candidate plans (no persistence) for the user to choose ---
router.post("/:id/plans", (req, res) => {
  const id = Number(req.params.id);
  const count = Math.min(Math.max(Number(req.body?.count) || 3, 1), 6);
  res.json(computePlans(id, count));
});

// --- apply a chosen plan's shifts ---
router.post("/:id/apply", (req, res) => {
  const id = Number(req.params.id);
  applyPlan(id, req.body.shifts || []);
  res.json({ ok: true, coverage: analyzeCoverage(id) });
});

// --- approve / unapprove (draft <-> final) ---
// Approving snapshots the current assignments as the BASELINE (the approved plan).
// Extra/shortfall in the monthly report are measured against this baseline.
router.put("/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status === "final" ? "final" : "draft";
  if (status === "final") {
    const rows = db
      .prepare("SELECT staff_id, date, start_time, end_time FROM assignments WHERE week_id=?")
      .all(id);
    db.prepare("UPDATE weeks SET status='final', baseline=? WHERE id=?").run(JSON.stringify(rows), id);
  } else {
    db.prepare("UPDATE weeks SET status='draft', baseline=NULL WHERE id=?").run(id);
  }
  res.json({ ok: true, status });
});

const isFinal = (weekId: number) =>
  (db.prepare("SELECT status FROM weeks WHERE id=?").get(weekId) as any)?.status === "final";

function logChange(args: {
  week_id: number;
  date: string;
  staff_id: number;
  action: "add" | "remove";
  start_time: string;
  end_time: string;
  reason_category?: string;
  reason_note?: string;
}) {
  const name = (db.prepare("SELECT name FROM staff WHERE id=?").get(args.staff_id) as any)?.name ?? null;
  db.prepare(
    `INSERT INTO schedule_changes (week_id, date, staff_id, staff_name, action, start_time, end_time, reason_category, reason_note)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    args.week_id,
    args.date,
    args.staff_id,
    name,
    args.action,
    args.start_time,
    args.end_time,
    args.reason_category ?? null,
    args.reason_note ?? null
  );
}

// --- manual assignments (after a week is final, a reason is required and the change is logged) ---
router.post("/:id/assignments", (req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const info = db
    .prepare(
      "INSERT INTO assignments (week_id, staff_id, date, start_time, end_time, source, is_replacement) VALUES (?,?,?,?,?,'manual',?)"
    )
    .run(id, b.staff_id, b.date, b.start_time, b.end_time, b.is_replacement ? 1 : 0);
  if (isFinal(id))
    logChange({
      week_id: id,
      date: b.date,
      staff_id: b.staff_id,
      action: "add",
      start_time: b.start_time,
      end_time: b.end_time,
      reason_category: b.reason_category,
      reason_note: b.reason_note,
    });
  res.json({ id: info.lastInsertRowid });
});
router.delete("/:id/assignments/:aid", (req, res) => {
  const id = Number(req.params.id);
  const aid = Number(req.params.aid);
  const a = db.prepare("SELECT * FROM assignments WHERE id=?").get(aid) as any;
  if (a && isFinal(id)) {
    const b = req.body || {};
    if (!b.reason_category) return res.status(400).json({ error: "reason required" });
    logChange({
      week_id: id,
      date: a.date,
      staff_id: a.staff_id,
      action: "remove",
      start_time: a.start_time,
      end_time: a.end_time,
      reason_category: b.reason_category,
      reason_note: b.reason_note,
    });
  }
  db.prepare("DELETE FROM assignments WHERE id=?").run(aid);
  res.json({ ok: true });
});

// --- day notes (colored, survive regeneration) ---
router.post("/:id/notes", (req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const info = db
    .prepare("INSERT INTO day_notes (week_id, date, text, color) VALUES (?,?,?,?)")
    .run(id, b.date, b.text, b.color || null);
  res.json({ id: info.lastInsertRowid });
});
router.delete("/:id/notes/:noteId", (req, res) => {
  db.prepare("DELETE FROM day_notes WHERE id=?").run(Number(req.params.noteId));
  res.json({ ok: true });
});

// --- replacement suggestions ---
// GET /api/weeks/:id/replacements?date=YYYY-MM-DD&start=HH:MM&end=HH:MM
router.get("/:id/replacements", (req, res) => {
  const id = Number(req.params.id);
  const { date, start, end } = req.query as Record<string, string>;
  res.json(suggestReplacements(id, date, start, end));
});

export default router;
