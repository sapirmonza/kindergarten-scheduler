import { Router } from "express";
import db from "../db";

const router = Router();

// GET /api/coverage -> all coverage requirements, grouped by day type
router.get("/", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM coverage_requirements ORDER BY day_type, start_time")
    .all();
  res.json(rows);
});

// PUT /api/coverage -> replace the full set (simple + safe for a small table)
router.put("/", (req, res) => {
  const rows = req.body as {
    day_type: "weekday" | "friday";
    start_time: string;
    end_time: string;
    required_count: number;
  }[];
  const del = db.prepare("DELETE FROM coverage_requirements");
  const ins = db.prepare(
    "INSERT INTO coverage_requirements (day_type, start_time, end_time, required_count) VALUES (?,?,?,?)"
  );
  const tx = db.transaction(() => {
    del.run();
    for (const r of rows) ins.run(r.day_type, r.start_time, r.end_time, r.required_count);
  });
  tx();
  res.json({ ok: true });
});

export default router;
