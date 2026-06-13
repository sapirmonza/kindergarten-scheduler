import { useEffect, useState } from "react";
import {
  api,
  DAY_NAMES,
  formatDate,
  REASON_LABELS,
  type ManagerReport,
  type ScheduleChange,
} from "../api";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const dow = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();

export default function ReportsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [tab, setTab] = useState<"changes" | "managers">("changes");
  const [changes, setChanges] = useState<ScheduleChange[]>([]);
  const [report, setReport] = useState<ManagerReport | null>(null);

  const loadChanges = () => api.getChanges(month).then(setChanges);
  useEffect(() => {
    loadChanges();
    api.getManagerReport(month).then(setReport);
  }, [month]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className="block text-sm font-medium mb-1">חודש</label>
          <input
            type="month"
            className="border border-slate-300 rounded-lg px-3 py-2"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {(
            [
              ["changes", "יומן שינויים"],
              ["managers", "סיכום מנהלות"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                tab === k ? "bg-emerald-600 text-white" : "bg-white border border-slate-300 text-slate-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "changes" ? (
        <ChangeLog changes={changes} month={month} onReload={loadChanges} />
      ) : (
        <ManagerSummary report={report} />
      )}
    </div>
  );
}

function ChangeLog({
  changes,
  month,
  onReload,
}: {
  changes: ScheduleChange[];
  month: string;
  onReload: () => void;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setSel((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const allSelected = changes.length > 0 && changes.every((c) => sel.has(c.id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(changes.map((c) => c.id)));
  async function delSelected() {
    if (!sel.size || !confirm(`למחוק ${sel.size} רשומות מהיומן?`)) return;
    await api.deleteChanges({ ids: [...sel] });
    setSel(new Set());
    onReload();
  }
  async function delAll() {
    if (!changes.length || !confirm("למחוק את כל רשומות היומן בחודש זה?")) return;
    await api.deleteChanges({ month });
    setSel(new Set());
    onReload();
  }

  if (changes.length === 0)
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        אין שינויים מתועדים בחודש זה.
      </div>
    );
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button
          onClick={delSelected}
          disabled={!sel.size}
          className="bg-red-600 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
        >
          מחק נבחרים ({sel.size})
        </button>
        <button
          onClick={delAll}
          className="border border-slate-300 hover:bg-slate-100 text-sm px-3 py-1.5 rounded-lg"
        >
          נקה הכל
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th className="text-right px-4 py-2 font-medium">יום / תאריך</th>
              <th className="text-right px-4 py-2 font-medium">אשת צוות</th>
              <th className="text-right px-4 py-2 font-medium">פעולה</th>
              <th className="text-right px-4 py-2 font-medium">משמרת</th>
              <th className="text-right px-4 py-2 font-medium">סיבה</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.id} className={`border-t border-slate-100 ${sel.has(c.id) ? "bg-emerald-50" : ""}`}>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                {DAY_NAMES[dow(c.date)]} {formatDate(c.date)}
              </td>
              <td className="px-4 py-2 font-medium">{c.staff_name || "—"}</td>
              <td className="px-4 py-2">
                {c.action === "remove" ? (
                  <span className="text-red-600">הסרה</span>
                ) : (
                  <span className="text-emerald-700">הוספה</span>
                )}
              </td>
              <td className="px-4 py-2 text-slate-600">
                {c.start_time ? `${c.start_time}–${c.end_time}` : "—"}
              </td>
              <td className="px-4 py-2">
                {c.reason_category && <span>{REASON_LABELS[c.reason_category]}</span>}
                {c.reason_category && c.reason_note ? <span className="text-slate-500"> · </span> : null}
                {c.reason_note && <span className="text-slate-500">{c.reason_note}</span>}
                {!c.reason_category && !c.reason_note ? "—" : null}
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManagerSummary({ report }: { report: ManagerReport | null }) {
  if (!report) return <p className="text-slate-500">טוען…</p>;
  if (report.managers.length === 0 || report.weeks.length === 0)
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        אין נתוני מנהלות לחודש זה.
      </div>
    );

  return (
    <div className="space-y-4">
      {report.managers.map((m) => {
        const t = m.totals;
        const hasExtra = t.extraMorning + t.extraAfternoon > 0;
        const hasShort = t.shortMorning + t.shortAfternoon > 0;
        return (
          <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="font-bold text-teal-700">
                {m.name}{" "}
                <span className="text-xs font-normal text-slate-400">
                  (מכסה: {m.morning_quota} בוקר · {m.afternoon_quota} צהריים לשבוע)
                </span>
              </h3>
              <div className="text-sm flex gap-3">
                <span className="text-slate-600">
                  עבדה: {t.workedMorning} בוקר · {t.workedAfternoon} צהריים
                </span>
                {hasExtra && (
                  <span className="text-amber-600 font-medium">
                    אקסטרה: {t.extraMorning > 0 ? `+${t.extraMorning} בוקר ` : ""}
                    {t.extraAfternoon > 0 ? `+${t.extraAfternoon} צהריים` : ""}
                  </span>
                )}
                {hasShort && (
                  <span className="text-red-600 font-medium">
                    חוסר: {t.shortMorning > 0 ? `${t.shortMorning} בוקר ` : ""}
                    {t.shortAfternoon > 0 ? `${t.shortAfternoon} צהריים` : ""}
                  </span>
                )}
                {!hasExtra && !hasShort && <span className="text-emerald-600 font-medium">בדיוק לפי המכסה ✓</span>}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {m.weeks.map((w) => (
                <div key={w.start_date} className="border border-slate-100 rounded-lg p-2">
                  <div className="text-sm font-medium mb-1">
                    שבוע {formatDate(w.start_date)}{" "}
                    <span className="text-xs font-normal text-slate-400">
                      ({w.morningCount}/{m.morning_quota} בוקר · {w.afternoonCount}/{m.afternoon_quota} צהריים)
                    </span>
                  </div>
                  {w.shifts.length === 0 ? (
                    <p className="text-xs text-slate-400">לא עבדה</p>
                  ) : (
                    <ul className="text-sm space-y-0.5">
                      {w.shifts.map((s, i) => (
                        <li key={i} className="flex items-center gap-1">
                          <span>
                            {DAY_NAMES[dow(s.date)]} {formatDate(s.date)} ·{" "}
                            {s.morning && s.afternoon ? "בוקר+צהריים" : s.morning ? "בוקר" : "צהריים"}{" "}
                            <span className="text-slate-400 text-xs">
                              {s.start}–{s.end}
                            </span>
                          </span>
                          {s.isExtra && <span className="text-xs text-amber-600 font-medium">אקסטרה</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
