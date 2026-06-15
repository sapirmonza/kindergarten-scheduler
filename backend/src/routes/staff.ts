import { Router } from "express";
import db from "../db";

const router = Router();

type Availability = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  frequency?: "weekly" | "biweekly";
  anchor_date?: string | null;
};

// GET /api/staff  -> all staff with their availability template
router.get("/", (_req, res) => {
  const staff = db.prepare("SELECT * FROM staff ORDER BY active DESC, name").all() as any[];
  const avail = db.prepare("SELECT * FROM staff_availability").all() as any[];
  const byStaff: Record<number, Availability[]> = {};
  for (const a of avail) {
    (byStaff[a.staff_id] ||= []).push({
      day_of_week: a.day_of_week,
      start_time: a.start_time,
      end_time: a.end_time,
      frequency: a.frequency || "weekly",
      anchor_date: a.anchor_date || null,
    });
  }
  res.json(staff.map((s) => ({ ...s, active: !!s.active, availability: byStaff[s.id] || [] })));
});

// POST /api/staff  -> create
router.post("/", (req, res) => {
  const b = req.body;
  const info = db
    .prepare(
      `INSERT INTO staff (name, type, friday_mode, friday_anchor, morning_quota, afternoon_quota, days_per_week, birth_date, active, notes)
       VALUES (@name, @type, @friday_mode, @friday_anchor, @morning_quota, @afternoon_quota, @days_per_week, @birth_date, @active, @notes)`
    )
    .run({
      name: b.name,
      type: b.type,
      friday_mode: b.friday_mode ?? "regular",
      friday_anchor: b.friday_anchor ?? null,
      morning_quota: b.morning_quota ?? 0,
      afternoon_quota: b.afternoon_quota ?? 0,
      days_per_week: b.days_per_week ?? null,
      birth_date: b.birth_date ?? null,
      active: b.active === false ? 0 : 1,
      notes: b.notes ?? null,
    });
  const id = info.lastInsertRowid as number;
  saveAvailability(id, b.availability || []);
  res.json({ id });
});

// PUT /api/staff/:id  -> update
router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  db.prepare(
    `UPDATE staff SET name=@name, type=@type, friday_mode=@friday_mode, friday_anchor=@friday_anchor,
       morning_quota=@morning_quota, afternoon_quota=@afternoon_quota, days_per_week=@days_per_week,
       birth_date=@birth_date, active=@active, notes=@notes
     WHERE id=@id`
  ).run({
    id,
    name: b.name,
    type: b.type,
    friday_mode: b.friday_mode ?? "regular",
    friday_anchor: b.friday_anchor ?? null,
    morning_quota: b.morning_quota ?? 0,
    afternoon_quota: b.afternoon_quota ?? 0,
    days_per_week: b.days_per_week ?? null,
    birth_date: b.birth_date ?? null,
    active: b.active === false ? 0 : 1,
    notes: b.notes ?? null,
  });
  saveAvailability(id, b.availability || []);
  res.json({ ok: true });
});

// DELETE /api/staff/:id
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM staff WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

function saveAvailability(staffId: number, rows: Availability[]) {
  const del = db.prepare("DELETE FROM staff_availability WHERE staff_id=?");
  const ins = db.prepare(
    "INSERT INTO staff_availability (staff_id, day_of_week, start_time, end_time, frequency, anchor_date) VALUES (?,?,?,?,?,?)"
  );
  const tx = db.transaction(() => {
    del.run(staffId);
    for (const r of rows)
      ins.run(
        staffId,
        r.day_of_week,
        r.start_time,
        r.end_time,
        r.frequency === "biweekly" ? "biweekly" : "weekly",
        r.frequency === "biweekly" ? r.anchor_date || null : null
      );
  });
  tx();
}

export default router;
