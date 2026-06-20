import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";

// DB file location: ./data/scheduler.db (mounted as a volume in Docker)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const raw = new DatabaseSync(path.join(DATA_DIR, "scheduler.db"));
raw.exec("PRAGMA journal_mode = WAL");
raw.exec("PRAGMA foreign_keys = ON");

// better-sqlite3-style transaction helper on top of node:sqlite.
// Returns a function that runs `fn` inside BEGIN/COMMIT (ROLLBACK on throw).
type TxFactory = <T extends (...args: any[]) => any>(fn: T) => T;
(raw as any).transaction = ((fn: (...a: any[]) => any) =>
  (...args: any[]) => {
    raw.exec("BEGIN");
    try {
      const result = fn(...args);
      raw.exec("COMMIT");
      return result;
    } catch (e) {
      raw.exec("ROLLBACK");
      throw e;
    }
  }) as TxFactory;

const db = raw as DatabaseSync & { transaction: TxFactory };

export function ensureTables(): void {
  db.exec(`
    -- Staff members. Two kinds:
    --   'regular' : fixed days + hours (weekly template in staff_availability)
    --   'manager' : hours-only, scheduled from weekly morning/afternoon quota
    CREATE TABLE IF NOT EXISTS staff (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      type            TEXT    NOT NULL CHECK (type IN ('regular','manager')),
      -- Friday handling per staff:
      --   'regular'  : works Friday normally per template/availability
      --   'none'     : never works Friday
      --   'morning'  : Friday morning only
      --   'biweekly' : every other Friday (parity from friday_anchor)
      friday_mode     TEXT    NOT NULL DEFAULT 'regular'
                              CHECK (friday_mode IN ('regular','none','morning','biweekly')),
      friday_anchor   TEXT,                 -- a known Friday she WORKED (YYYY-MM-DD), for biweekly parity
      morning_quota   INTEGER NOT NULL DEFAULT 0,   -- managers: mornings per week (08:00-13:00)
      afternoon_quota INTEGER NOT NULL DEFAULT 0,   -- managers: afternoons per week (13:00-16:00)
      days_per_week   INTEGER,                       -- regulars: how many of her available days she works (null = all)
      birth_date      TEXT,                           -- YYYY-MM-DD (for automatic birthday notes)
      active          INTEGER NOT NULL DEFAULT 1,
      notes           TEXT
    );

    -- Weekly availability template for REGULAR staff.
    -- day_of_week: 0=Sunday ... 5=Friday (kindergarten works Sun-Fri)
    -- frequency: 'weekly' or 'biweekly' (every other week). For biweekly, anchor_date is a
    --   known date of that weekday she works; parity for any week is computed from it.
    CREATE TABLE IF NOT EXISTS staff_availability (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 5),
      start_time  TEXT    NOT NULL,          -- 'HH:MM'
      end_time    TEXT    NOT NULL,
      frequency   TEXT    NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly','biweekly')),
      anchor_date TEXT
    );

    -- Coverage requirements per day type and time segment.
    -- day_type: 'weekday' (Sun-Thu) or 'friday'
    CREATE TABLE IF NOT EXISTS coverage_requirements (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      day_type       TEXT    NOT NULL CHECK (day_type IN ('weekday','friday')),
      start_time     TEXT    NOT NULL,
      end_time       TEXT    NOT NULL,
      required_count INTEGER NOT NULL
    );

    -- A planned week (start_date = the Sunday of that week, YYYY-MM-DD).
    CREATE TABLE IF NOT EXISTS weeks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date TEXT    NOT NULL UNIQUE,
      status     TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
      baseline   TEXT,                              -- JSON snapshot of assignments at approval time
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Per-week staff availability adjustments.
    -- direction: 'block' (can't work) or 'available' (extra availability beyond the template).
    -- If start/end null => whole day. For managers, morning=08:00-13:00 / afternoon=13:00-16:00.
    CREATE TABLE IF NOT EXISTS constraints (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id    INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      date       TEXT    NOT NULL,           -- YYYY-MM-DD
      direction  TEXT    NOT NULL DEFAULT 'block' CHECK (direction IN ('block','available','required')),
      start_time TEXT,                        -- null => whole day
      end_time   TEXT,
      note       TEXT
    );

    -- Closures / holidays / ad-hoc non-working windows for a week.
    CREATE TABLE IF NOT EXISTS closures (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id    INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      date       TEXT    NOT NULL,
      start_time TEXT,                        -- null => closed all day
      end_time   TEXT,
      reason     TEXT
    );

    -- Generated schedule assignments.
    CREATE TABLE IF NOT EXISTS assignments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id        INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      staff_id       INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      date           TEXT    NOT NULL,
      start_time     TEXT    NOT NULL,
      end_time       TEXT    NOT NULL,
      source         TEXT    NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
      is_replacement INTEGER NOT NULL DEFAULT 0
    );

    -- Post-approval change log (audit). Records add/remove of shifts after a week is final,
    -- with the reason. staff_name is snapshotted so the log stays readable.
    CREATE TABLE IF NOT EXISTS schedule_changes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id         INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      date            TEXT    NOT NULL,
      staff_id        INTEGER,
      staff_name      TEXT,
      action          TEXT    NOT NULL CHECK (action IN ('add','remove')),
      start_time      TEXT,
      end_time        TEXT,
      reason_category TEXT,                 -- 'sick' | 'vacation' | 'other'
      reason_note     TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Free-text colored notes pinned to a specific day of a week (survive schedule regeneration).
    CREATE TABLE IF NOT EXISTS day_notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id    INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      date       TEXT    NOT NULL,
      text       TEXT    NOT NULL,
      color      TEXT,                              -- background color (hex)
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_avail_staff   ON staff_availability(staff_id);
    CREATE INDEX IF NOT EXISTS idx_changes_week  ON schedule_changes(week_id);
    CREATE INDEX IF NOT EXISTS idx_notes_week    ON day_notes(week_id);
    CREATE INDEX IF NOT EXISTS idx_constr_week   ON constraints(week_id);
    CREATE INDEX IF NOT EXISTS idx_closure_week  ON closures(week_id);
    CREATE INDEX IF NOT EXISTS idx_assign_week   ON assignments(week_id);
  `);

  // migration: add constraints.direction to pre-existing tables
  const constraintCols = db.prepare("PRAGMA table_info(constraints)").all() as any[];
  if (!constraintCols.some((c) => c.name === "direction")) {
    db.exec("ALTER TABLE constraints ADD COLUMN direction TEXT NOT NULL DEFAULT 'block'");
  }
  // migration: widen the direction CHECK to allow 'required' (rebuild table if its CHECK lacks it)
  const constrSql =
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='constraints'").get() as any)?.sql || "";
  if (constrSql.includes("CHECK") && constrSql.includes("direction") && !constrSql.includes("required")) {
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec(`
      CREATE TABLE constraints_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id    INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
        staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        date       TEXT    NOT NULL,
        direction  TEXT    NOT NULL DEFAULT 'block' CHECK (direction IN ('block','available','required')),
        start_time TEXT,
        end_time   TEXT,
        note       TEXT
      );
      INSERT INTO constraints_new (id, week_id, staff_id, date, direction, start_time, end_time, note)
        SELECT id, week_id, staff_id, date, direction, start_time, end_time, note FROM constraints;
      DROP TABLE constraints;
      ALTER TABLE constraints_new RENAME TO constraints;
    `);
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("CREATE INDEX IF NOT EXISTS idx_constr_week ON constraints(week_id)");
  }

  // migration: add per-day biweekly support to staff_availability
  const availCols = db.prepare("PRAGMA table_info(staff_availability)").all() as any[];
  if (!availCols.some((c) => c.name === "frequency")) {
    db.exec("ALTER TABLE staff_availability ADD COLUMN frequency TEXT NOT NULL DEFAULT 'weekly'");
  }
  if (!availCols.some((c) => c.name === "anchor_date")) {
    db.exec("ALTER TABLE staff_availability ADD COLUMN anchor_date TEXT");
  }

  // migration: add staff.days_per_week (regular weekly day target; null = all available days)
  const staffCols = db.prepare("PRAGMA table_info(staff)").all() as any[];
  if (!staffCols.some((c) => c.name === "days_per_week")) {
    db.exec("ALTER TABLE staff ADD COLUMN days_per_week INTEGER");
  }
  if (!staffCols.some((c) => c.name === "birth_date")) {
    db.exec("ALTER TABLE staff ADD COLUMN birth_date TEXT");
  }

  // migration: add weeks.baseline (approval-time snapshot for extra/shortfall vs the plan)
  const weekCols = db.prepare("PRAGMA table_info(weeks)").all() as any[];
  if (!weekCols.some((c) => c.name === "baseline")) {
    db.exec("ALTER TABLE weeks ADD COLUMN baseline TEXT");
  }

  seedCoverageDefaults();
}

// Seed the coverage requirements you specified, only if the table is empty.
function seedCoverageDefaults(): void {
  const count = db.prepare("SELECT COUNT(*) AS c FROM coverage_requirements").get() as { c: number };
  if (count.c > 0) return;

  const insert = db.prepare(
    "INSERT INTO coverage_requirements (day_type, start_time, end_time, required_count) VALUES (?,?,?,?)"
  );

  const weekday: [string, string, number][] = [
    ["07:30", "07:45", 2],
    ["07:45", "08:00", 3],
    ["08:00", "13:00", 10],
    ["13:00", "16:00", 8],
    ["16:00", "16:15", 2],
    ["16:15", "16:30", 1],
  ];
  const friday: [string, string, number][] = [
    ["07:30", "08:00", 2],
    ["08:00", "12:00", 6],
  ];

  const tx = db.transaction(() => {
    for (const [s, e, n] of weekday) insert.run("weekday", s, e, n);
    for (const [s, e, n] of friday) insert.run("friday", s, e, n);
  });
  tx();
}

export default db;
