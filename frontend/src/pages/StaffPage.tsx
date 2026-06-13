import { useEffect, useState } from "react";
import { api, DAY_NAMES, type Availability, type Staff } from "../api";

const FRIDAY_LABELS: Record<Staff["friday_mode"], string> = {
  regular: "רגיל (לפי התבנית)",
  none: "לא רלוונטי",
  morning: "בוקר בלבד",
  biweekly: "פעם בשבועיים",
};

const emptyStaff: Partial<Staff> = {
  name: "",
  type: "regular",
  friday_mode: "regular",
  friday_anchor: null,
  morning_quota: 0,
  afternoon_quota: 0,
  days_per_week: null,
  active: true,
  notes: "",
  availability: [],
};

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [editing, setEditing] = useState<Partial<Staff> | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setStaff(await api.getStaff());
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save(s: Partial<Staff>) {
    if (s.id) await api.updateStaff(s.id, s);
    else await api.createStaff(s);
    setEditing(null);
    await load();
  }

  async function remove(id: number) {
    if (!confirm("למחוק את אשת הצוות?")) return;
    await api.deleteStaff(id);
    await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">ניהול צוות</h2>
        <button
          onClick={() => setEditing({ ...emptyStaff })}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + הוספת אשת צוות
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500">טוען…</p>
      ) : staff.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          עדיין אין נשות צוות. לחצי על "הוספת אשת צוות" כדי להתחיל.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-right px-4 py-2 font-medium">שם</th>
                <th className="text-right px-4 py-2 font-medium">סוג</th>
                <th className="text-right px-4 py-2 font-medium">ימים / מכסה</th>
                <th className="text-right px-4 py-2 font-medium">שישי</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className={`border-t border-slate-100 ${!s.active ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2 font-medium">{s.name}</td>
                  <td className="px-4 py-2">{s.type === "manager" ? "מנהלת" : "קבועה"}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {s.type === "manager"
                      ? `${s.morning_quota} בקרים · ${s.afternoon_quota} צהריים`
                      : s.availability.length
                      ? [...new Set(s.availability.map((a) => a.day_of_week))]
                          .sort((a, b) => a - b)
                          .map((day) => {
                            const rows = s.availability.filter((a) => a.day_of_week === day);
                            const suffix =
                              rows.length >= 2
                                ? " (שעות מתחלפות)"
                                : rows[0].frequency === "biweekly"
                                ? " (כל שבועיים)"
                                : "";
                            return DAY_NAMES[day] + suffix;
                          })
                          .join(", ")
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{FRIDAY_LABELS[s.friday_mode]}</td>
                  <td className="px-4 py-2 text-left whitespace-nowrap">
                    <button onClick={() => setEditing(s)} className="text-emerald-700 hover:underline ml-3">
                      עריכה
                    </button>
                    <button onClick={() => remove(s.id)} className="text-red-600 hover:underline">
                      מחיקה
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <StaffForm initial={editing} onCancel={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function StaffForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: Partial<Staff>;
  onCancel: () => void;
  onSave: (s: Partial<Staff>) => void;
}) {
  const [f, setF] = useState<Partial<Staff>>({ ...initial });
  const set = (patch: Partial<Staff>) => setF((p) => ({ ...p, ...patch }));

  // Per-day editing. A day can be: off / weekly / biweekly (alternate weeks) /
  // alternating (works every week but with two different hour-sets that alternate).
  // 'alternating' is stored as two biweekly rows with opposite-parity anchors.
  type DayMode = "off" | "weekly" | "biweekly" | "alternating";
  const defaultHours = (day: number): [string, string] => (day === 5 ? ["07:30", "12:00"] : ["07:30", "16:30"]);

  function rowsForDay(day: number): Availability[] {
    return (f.availability || [])
      .filter((a) => a.day_of_week === day)
      .sort((a, b) => (a.anchor_date || "").localeCompare(b.anchor_date || ""));
  }
  function dayMode(day: number): DayMode {
    const rows = rowsForDay(day);
    if (rows.length === 0) return "off";
    if (rows.length >= 2) return "alternating";
    return rows[0].frequency === "biweekly" ? "biweekly" : "weekly";
  }
  function writeDay(day: number, rows: Availability[]) {
    const rest = (f.availability || []).filter((a) => a.day_of_week !== day);
    set({ availability: [...rest, ...rows] });
  }
  // next calendar date (today or later) on weekday `day` (0=Sunday) — default biweekly anchor
  function nextWeekdayDate(day: number): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7));
    return isoOf(d);
  }
  function addDaysStr(iso: string, n: number): string {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return isoOf(d);
  }
  function isoOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function toggleDay(day: number, on: boolean) {
    if (!on) return writeDay(day, []);
    const [s, e] = defaultHours(day);
    writeDay(day, [{ day_of_week: day, start_time: s, end_time: e, frequency: "weekly", anchor_date: null }]);
  }
  function setDayMode(day: number, mode: DayMode) {
    const rows = rowsForDay(day);
    const [ds, de] = defaultHours(day);
    const s = rows[0]?.start_time ?? ds;
    const e = rows[0]?.end_time ?? de;
    if (mode === "weekly") {
      writeDay(day, [{ day_of_week: day, start_time: s, end_time: e, frequency: "weekly", anchor_date: null }]);
    } else if (mode === "biweekly") {
      writeDay(day, [
        { day_of_week: day, start_time: s, end_time: e, frequency: "biweekly", anchor_date: rows[0]?.anchor_date || nextWeekdayDate(day) },
      ]);
    } else {
      // alternating: two biweekly rows, week B anchored one week after week A
      const anchorA = rows[0]?.anchor_date || nextWeekdayDate(day);
      writeDay(day, [
        { day_of_week: day, start_time: s, end_time: e, frequency: "biweekly", anchor_date: anchorA },
        {
          day_of_week: day,
          start_time: rows[1]?.start_time ?? "13:00",
          end_time: rows[1]?.end_time ?? "16:00",
          frequency: "biweekly",
          anchor_date: addDaysStr(anchorA, 7),
        },
      ]);
    }
  }
  // edit one window's time. idx 0 = single / week A, idx 1 = week B
  function setRowTime(day: number, idx: number, key: "start_time" | "end_time", val: string) {
    const rows = rowsForDay(day).map((r, i) => (i === idx ? { ...r, [key]: val } : r));
    writeDay(day, rows);
  }
  // set the "week A" anchor; in alternating mode week B is automatically anchor + 7 days
  function setAnchor(day: number, dateA: string) {
    const rows = rowsForDay(day);
    if (rows.length >= 2) writeDay(day, [{ ...rows[0], anchor_date: dateA }, { ...rows[1], anchor_date: addDaysStr(dateA, 7) }]);
    else if (rows.length === 1) writeDay(day, [{ ...rows[0], anchor_date: dateA }]);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 overflow-auto z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h3 className="text-lg font-bold mb-4">{f.id ? "עריכת אשת צוות" : "הוספת אשת צוות"}</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">שם</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={f.name || ""}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">סוג</label>
            <div className="flex gap-2">
              {(["regular", "manager"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => set({ type: t })}
                  className={`flex-1 py-2 rounded-lg border text-sm ${
                    f.type === t ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-300"
                  }`}
                >
                  {t === "manager" ? "מנהלת (שעות בלבד)" : "קבועה (ימים + שעות)"}
                </button>
              ))}
            </div>
          </div>

          {f.type === "manager" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">בקרים בשבוע (08:00–13:00)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={f.morning_quota ?? 0}
                  onChange={(e) => set({ morning_quota: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">צהריים בשבוע (13:00–16:00)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={f.afternoon_quota ?? 0}
                  onChange={(e) => set({ afternoon_quota: Number(e.target.value) })}
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">ימים ושעות קבועים</label>
              <div className="space-y-1">
                {DAY_NAMES.map((name, day) => {
                  const mode = dayMode(day);
                  const rows = rowsForDay(day);
                  const on = mode !== "off";
                  const timeInput = (idx: number, key: "start_time" | "end_time") => (
                    <input
                      type="time"
                      className="border border-slate-300 rounded px-2 py-1 text-sm"
                      value={rows[idx]?.[key] || ""}
                      onChange={(e) => setRowTime(day, idx, key, e.target.value)}
                    />
                  );
                  return (
                    <div key={day} className="rounded-lg border border-slate-100 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1 w-20">
                          <input type="checkbox" checked={on} onChange={(e) => toggleDay(day, e.target.checked)} />
                          <span className="text-sm">{name}</span>
                        </label>
                        {on && (
                          <select
                            className="border border-slate-300 rounded px-1.5 py-1 text-sm"
                            value={mode}
                            onChange={(e) => setDayMode(day, e.target.value as DayMode)}
                          >
                            <option value="weekly">כל שבוע</option>
                            <option value="biweekly">פעם בשבועיים</option>
                            <option value="alternating">שעות מתחלפות</option>
                          </select>
                        )}
                        {on && mode !== "alternating" && (
                          <>
                            {timeInput(0, "start_time")}
                            <span className="text-slate-400">–</span>
                            {timeInput(0, "end_time")}
                          </>
                        )}
                      </div>

                      {on && mode === "biweekly" && (
                        <div className="mt-1 mr-20 flex items-center gap-1 text-xs text-slate-500">
                          שבוע שעובדת:
                          <input
                            type="date"
                            className="border border-slate-300 rounded px-1.5 py-1 text-xs"
                            value={rows[0]?.anchor_date || ""}
                            onChange={(e) => setAnchor(day, e.target.value)}
                          />
                        </div>
                      )}

                      {on && mode === "alternating" && (
                        <div className="mt-1 mr-20 space-y-1">
                          <div className="flex items-center gap-1">
                            <span className="w-12 text-xs text-slate-500">שבוע א':</span>
                            {timeInput(0, "start_time")}
                            <span className="text-slate-400">–</span>
                            {timeInput(0, "end_time")}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="w-12 text-xs text-slate-500">שבוע ב':</span>
                            {timeInput(1, "start_time")}
                            <span className="text-slate-400">–</span>
                            {timeInput(1, "end_time")}
                          </div>
                          <label className="flex items-center gap-1 text-xs text-slate-500">
                            שבוע א' מתחיל ב:
                            <input
                              type="date"
                              className="border border-slate-300 rounded px-1.5 py-1 text-xs"
                              value={rows[0]?.anchor_date || ""}
                              onChange={(e) => setAnchor(day, e.target.value)}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium mb-1">ימים בשבוע</label>
                <input
                  type="number"
                  min={0}
                  placeholder="ריק = כל הימים המסומנים"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={f.days_per_week ?? ""}
                  onChange={(e) => set({ days_per_week: e.target.value === "" ? null : Number(e.target.value) })}
                />
                <p className="text-xs text-slate-400 mt-1">
                  כמה מהימים המסומנים היא עובדת בפועל. ריק = את כולם (קבוע). מספר קטן יותר → המערכת בוחרת אילו ימים, לפי הצורך.
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">שישי</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={f.friday_mode}
              onChange={(e) => set({ friday_mode: e.target.value as Staff["friday_mode"] })}
            >
              {Object.entries(FRIDAY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {f.friday_mode === "biweekly" && (
              <div className="mt-2">
                <label className="block text-sm text-slate-600 mb-1">
                  תאריך שישי ידוע שבו עבדה (עוגן לחישוב הסירוגין)
                </label>
                <input
                  type="date"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={f.friday_anchor || ""}
                  onChange={(e) => set({ friday_anchor: e.target.value || null })}
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">הערות</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              rows={2}
              value={f.notes || ""}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.active !== false}
              onChange={(e) => set({ active: e.target.checked })}
            />
            פעילה
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">
            ביטול
          </button>
          <button
            onClick={() => f.name?.trim() && onSave(f)}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium"
          >
            שמירה
          </button>
        </div>
      </div>
    </div>
  );
}
