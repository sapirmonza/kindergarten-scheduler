// Tiny API helper. All endpoints are under /api (proxied to the backend in dev).

export type Availability = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  frequency?: "weekly" | "biweekly";
  anchor_date?: string | null;
};

export type Staff = {
  id: number;
  name: string;
  type: "regular" | "manager";
  friday_mode: "regular" | "none" | "morning" | "biweekly";
  friday_anchor: string | null;
  morning_quota: number;
  afternoon_quota: number;
  days_per_week: number | null;
  active: boolean;
  notes: string | null;
  availability: Availability[];
};

export type Coverage = {
  id: number;
  day_type: "weekday" | "friday";
  start_time: string;
  end_time: string;
  required_count: number;
};

const TOKEN_KEY = "kg_token";
export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  isLoggedIn() {
    return !!localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  logout() {
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  },
};

async function http<T>(url: string, options?: RequestInit): Promise<T> {
  const token = auth.token;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (res.status === 401) {
    // token missing/expired -> back to login
    localStorage.removeItem(TOKEN_KEY);
    if (!url.endsWith("/login")) location.reload();
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`שגיאת שרת (${res.status})`);
  return res.json();
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("שם משתמש או סיסמה שגויים");
  const { token } = await res.json();
  auth.set(token);
}

export type Week = { id: number; start_date: string; status: "draft" | "final"; created_at: string };
export type Constraint = {
  id: number;
  staff_id: number;
  date: string;
  direction: "block" | "available";
  start_time: string | null;
  end_time: string | null;
  note: string | null;
};
export type Closure = {
  id: number;
  date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};
export type Assignment = {
  id: number;
  staff_id: number;
  date: string;
  start_time: string;
  end_time: string;
  source: "auto" | "manual";
  is_replacement: number;
};
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
export type WeekBundle = {
  week: Week;
  constraints: Constraint[];
  closures: Closure[];
  assignments: Assignment[];
  coverage: DayCoverage[];
};
export type Replacement = {
  staff_id: number;
  name: string;
  type: string;
  suggested_start: string;
  suggested_end: string;
  reason: string;
};
export type GeneratedPlan = {
  shortage: number;
  surplus: number;
  missingPresence: number;
  shifts: { staff_id: number; date: string; start_time: string; end_time: string }[];
  shortages: { date: string; day_of_week: number; start: string; end: string; shortage: number }[];
  managers: { name: string; date: string; day_of_week: number; slot: "morning" | "afternoon" }[];
};

export type ReasonCategory = "sick" | "vacation" | "other";
export type ChangeReason = { reason_category?: ReasonCategory; reason_note?: string | null };
export type ScheduleChange = {
  id: number;
  week_id: number;
  date: string;
  staff_id: number | null;
  staff_name: string | null;
  action: "add" | "remove";
  start_time: string | null;
  end_time: string | null;
  reason_category: ReasonCategory | null;
  reason_note: string | null;
  created_at: string;
  week_start: string;
};
export type ManagerMonthly = {
  id: number;
  name: string;
  morning_quota: number;
  afternoon_quota: number;
  totals: {
    workedMorning: number;
    workedAfternoon: number;
    extraMorning: number;
    shortMorning: number;
    extraAfternoon: number;
    shortAfternoon: number;
  };
  weeks: {
    start_date: string;
    morningCount: number;
    afternoonCount: number;
    extraMorning: number;
    shortMorning: number;
    extraAfternoon: number;
    shortAfternoon: number;
    shifts: { date: string; start: string; end: string; morning: boolean; afternoon: boolean; isExtra: boolean }[];
  }[];
};
export type ManagerReport = { month: string; weeks: string[]; managers: ManagerMonthly[] };

export const api = {
  getStaff: () => http<Staff[]>("/api/staff"),
  createStaff: (s: Partial<Staff>) =>
    http<{ id: number }>("/api/staff", { method: "POST", body: JSON.stringify(s) }),
  updateStaff: (id: number, s: Partial<Staff>) =>
    http<{ ok: true }>(`/api/staff/${id}`, { method: "PUT", body: JSON.stringify(s) }),
  deleteStaff: (id: number) =>
    http<{ ok: true }>(`/api/staff/${id}`, { method: "DELETE" }),

  getCoverage: () => http<Coverage[]>("/api/coverage"),
  saveCoverage: (rows: Omit<Coverage, "id">[]) =>
    http<{ ok: true }>("/api/coverage", { method: "PUT", body: JSON.stringify(rows) }),

  getWeeks: () => http<Week[]>("/api/weeks"),
  createWeek: (start_date: string) =>
    http<Week>("/api/weeks", { method: "POST", body: JSON.stringify({ start_date }) }),
  deleteWeek: (id: number) => http<{ ok: true }>(`/api/weeks/${id}`, { method: "DELETE" }),
  getWeek: (id: number) => http<WeekBundle>(`/api/weeks/${id}`),
  generate: (id: number) =>
    http<{ ok: true; coverage: DayCoverage[] }>(`/api/weeks/${id}/generate`, { method: "POST" }),
  setStatus: (id: number, status: "draft" | "final") =>
    http<{ ok: true; status: string }>(`/api/weeks/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),
  getPlans: (id: number, count = 3) =>
    http<GeneratedPlan[]>(`/api/weeks/${id}/plans`, { method: "POST", body: JSON.stringify({ count }) }),
  applyPlan: (id: number, shifts: GeneratedPlan["shifts"]) =>
    http<{ ok: true; coverage: DayCoverage[] }>(`/api/weeks/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({ shifts }),
    }),

  addConstraint: (id: number, c: Partial<Constraint>) =>
    http<{ id: number }>(`/api/weeks/${id}/constraints`, { method: "POST", body: JSON.stringify(c) }),
  deleteConstraint: (id: number, cid: number) =>
    http<{ ok: true }>(`/api/weeks/${id}/constraints/${cid}`, { method: "DELETE" }),

  addClosure: (id: number, c: Partial<Closure>) =>
    http<{ id: number }>(`/api/weeks/${id}/closures`, { method: "POST", body: JSON.stringify(c) }),
  deleteClosure: (id: number, cid: number) =>
    http<{ ok: true }>(`/api/weeks/${id}/closures/${cid}`, { method: "DELETE" }),

  addAssignment: (id: number, a: Partial<Assignment> & ChangeReason) =>
    http<{ id: number }>(`/api/weeks/${id}/assignments`, { method: "POST", body: JSON.stringify(a) }),
  deleteAssignment: (id: number, aid: number, reason?: ChangeReason) =>
    http<{ ok: true }>(`/api/weeks/${id}/assignments/${aid}`, {
      method: "DELETE",
      body: reason ? JSON.stringify(reason) : undefined,
    }),

  getChanges: (month: string) => http<ScheduleChange[]>(`/api/reports/changes?month=${month}`),
  deleteChanges: (payload: { ids?: number[]; month?: string }) =>
    http<{ ok: true }>("/api/reports/changes/delete", { method: "POST", body: JSON.stringify(payload) }),
  getManagerReport: (month: string) => http<ManagerReport>(`/api/reports/managers?month=${month}`),

  getReplacements: (id: number, date: string, start: string, end: string) =>
    http<Replacement[]>(
      `/api/weeks/${id}/replacements?date=${date}&start=${start}&end=${end}`
    ),
};

export const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי"];

export const REASON_LABELS: Record<ReasonCategory, string> = {
  sick: "מחלה",
  vacation: "חופשה",
  other: "אחר",
};

// Format YYYY-MM-DD as a Hebrew day + DD/MM
export function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

// Find the Sunday on/before a given date (week start)
export function sundayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const MONTH_NAMES = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

// All week-start Sundays whose Sun–Thu range intersects the given month (month is 1-12).
// Includes a boundary week that spills into the previous/next month.
export function weeksOfMonth(year: number, month: number): string[] {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const firstSun = new Date(monthStart);
  firstSun.setUTCDate(firstSun.getUTCDate() - firstSun.getUTCDay()); // Sunday of the week containing the 1st
  const out: string[] = [];
  for (const d = new Date(firstSun); d <= monthEnd; d.setUTCDate(d.getUTCDate() + 7)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
