import { useEffect, useState } from "react";
import {
  addDaysISO,
  api,
  DAY_NAMES,
  formatDate,
  MONTH_NAMES,
  REASON_LABELS,
  weeksOfMonth,
  type ChangeReason,
  type ReasonCategory,
  type Assignment,
  type Constraint,
  type CoverageSegment,
  type DayCoverage,
  type GeneratedPlan,
  type Replacement,
  type Staff,
  type WeekBundle,
} from "../api";

// Compare candidate plans: count how many plans contain each shortage / manager-assignment,
// so the UI can highlight what DIFFERS (count < numPlans) vs what's common (count === numPlans).
function comparePlans(plans: GeneratedPlan[]) {
  const numPlans = plans.length;
  const shKeyCount: Record<string, number> = {};
  const mgrKeyCount: Record<string, number> = {};
  const sigs: { sh: string; mgr: string }[] = [];
  for (const p of plans) {
    const shSeen = new Set<string>();
    const mgrSeen = new Set<string>();
    for (const s of p.shortages) {
      const k = `${s.day_of_week}|${s.start}|${s.end}`;
      if (!shSeen.has(k)) {
        shSeen.add(k);
        shKeyCount[k] = (shKeyCount[k] || 0) + 1;
      }
    }
    for (const m of p.managers) {
      const k = `${m.name}|${m.day_of_week}|${m.slot}`;
      if (!mgrSeen.has(k)) {
        mgrSeen.add(k);
        mgrKeyCount[k] = (mgrKeyCount[k] || 0) + 1;
      }
    }
    sigs.push({ sh: [...shSeen].sort().join(";"), mgr: [...mgrSeen].sort().join(";") });
  }
  return {
    numPlans,
    shKeyCount,
    mgrKeyCount,
    shortagesIdentical: sigs.every((s) => s.sh === sigs[0].sh),
    mgrIdentical: sigs.every((s) => s.mgr === sigs[0].mgr),
  };
}

export default function WeekPage() {
  const [weeks, setWeeks] = useState<{ id: number; start_date: string }[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bundle, setBundle] = useState<WeekBundle | null>(null);
  const [generating, setGenerating] = useState(false);
  const [plans, setPlans] = useState<GeneratedPlan[] | null>(null);
  const [planDetail, setPlanDetail] = useState<Set<number>>(new Set());
  const togglePlanDetail = (i: number) =>
    setPlanDetail((p) => {
      const n = new Set(p);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12

  async function loadWeeks() {
    const w = await api.getWeeks();
    setWeeks(w);
    return w;
  }
  // open the ACTIVE week: this week's Sunday, or next Sunday if today is Saturday
  function goToActiveWeek() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay(); // 0=Sun .. 6=Sat
    d.setDate(d.getDate() + (dow === 6 ? 1 : -dow));
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    openWeek(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }

  useEffect(() => {
    (async () => {
      setStaff(await api.getStaff());
      await loadWeeks();
      goToActiveWeek();
    })();
  }, []);

  async function loadBundle(id: number) {
    setBundle(await api.getWeek(id));
  }
  useEffect(() => {
    if (selectedId) loadBundle(selectedId);
  }, [selectedId]);

  // open (or create) the week starting on the given Sunday
  async function openWeek(sunday: string) {
    if (!sunday) return;
    const week = await api.createWeek(sunday);
    await loadWeeks();
    setSelectedId(week.id);
  }

  async function generate() {
    if (!selectedId) return;
    const hasExisting = (bundle?.assignments.length ?? 0) > 0;
    if (
      hasExisting &&
      !confirm('פעולה זו תיצור תוכניות חדשות. השינויים הידניים הקיימים יוחלפו בתוכנית שתבחר. להמשיך?')
    )
      return;
    setGenerating(true);
    const p = await api.getPlans(selectedId, 3);
    setPlans(p);
    setGenerating(false);
  }
  async function choosePlan(plan: GeneratedPlan) {
    if (!selectedId) return;
    await api.applyPlan(selectedId, plan.shifts);
    setPlans(null);
    await loadBundle(selectedId);
  }

  async function toggleApprove() {
    if (!selectedId || !bundle) return;
    await api.setStatus(selectedId, bundle.week.status === "final" ? "draft" : "final");
    await loadBundle(selectedId);
  }

  const staffName = (id: number) => staff.find((s) => s.id === id)?.name || `#${id}`;
  const locked = bundle?.week.status === "final";
  const hasSchedule = (bundle?.assignments.length ?? 0) > 0;
  const selectedSunday = bundle?.week.start_date ?? null;
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-5 no-print">
        <div>
          <label className="block text-sm font-medium mb-1">שנה</label>
          <select
            className="border border-slate-300 rounded-lg px-3 py-2"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">חודש</label>
          <select
            className="border border-slate-300 rounded-lg px-3 py-2"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={i} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">שבוע (ראשון–שישי)</label>
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 min-w-48"
            value={selectedSunday ?? ""}
            onChange={(e) => openWeek(e.target.value)}
          >
            <option value="">בחר שבוע…</option>
            {weeksOfMonth(year, month).map((sun) => {
              const isPast = addDaysISO(sun, 5) < todayISO; // whole week already ended
              return (
                <option key={sun} value={sun}>
                  {formatDate(sun)} – {formatDate(addDaysISO(sun, 5))}
                  {isPast ? " ✓ (עבר)" : ""}
                </option>
              );
            })}
          </select>
        </div>
        <button
          onClick={goToActiveWeek}
          title="חזרה לשבוע הנוכחי"
          className="border border-slate-300 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm"
        >
          ↩ שבוע אקטיבי
        </button>
        <div className="flex-1" />
        {selectedId && (
          <>
            <button
              onClick={generate}
              disabled={generating || locked}
              title={locked ? "בטל אישור כדי לייצר מחדש" : ""}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg"
            >
              {generating ? "מייצר…" : "✨ ייצר לו\"ז"}
            </button>
            {hasSchedule && (
              <>
                <button
                  onClick={toggleApprove}
                  className={`font-medium px-5 py-2 rounded-lg text-white ${
                    locked ? "bg-slate-500 hover:bg-slate-600" : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {locked ? "בטל אישור" : "✓ אשר לו\"ז"}
                </button>
                <button
                  onClick={() => window.print()}
                  className="border border-slate-300 hover:bg-slate-100 font-medium px-5 py-2 rounded-lg"
                >
                  🖨️ הדפסה
                </button>
              </>
            )}
          </>
        )}
      </div>

      {!selectedId ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 no-print">
          בחר תאריך כדי ליצור / לפתוח שבוע.
        </div>
      ) : !bundle ? (
        <p className="text-slate-500">טוען…</p>
      ) : (
        <div className="space-y-6">
          {/* print-only title */}
          <div className="print-only mb-2">
            <h2 className="text-xl font-bold">
              לו"ז שבועי · {formatDate(bundle.week.start_date)} – {formatDate(addDaysISO(bundle.week.start_date, 5))}
            </h2>
            {locked && <p className="text-sm">סטטוס: מאושר</p>}
          </div>

          {!locked && (
            <div className="grid gap-6 lg:grid-cols-2 no-print">
              <ConstraintsPanel bundle={bundle} staff={staff} onChange={() => loadBundle(selectedId)} />
              <ClosuresPanel bundle={bundle} onChange={() => loadBundle(selectedId)} />
            </div>
          )}

          <ScheduleGrid
            bundle={bundle}
            staff={staff}
            staffName={staffName}
            locked={locked}
            onChange={() => loadBundle(selectedId)}
          />
        </div>
      )}

      {plans && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 overflow-auto z-50 no-print">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
            <h3 className="text-lg font-bold mb-1">בחירת תוכנית</h3>
            <p className="text-sm text-slate-500 mb-4">
              התוכניות ממוינות מהטובה ביותר. כשהמספרים זהים — הן <b>שקולות באיכות</b>, ונבדלות רק ב<b>פיזור</b> (היכן
              החוסרים ואיך מחולקות המנהלות). השווה למטה ובחר.
            </p>
            {plans.length === 0 ? (
              <p className="text-sm text-slate-500">לא נמצאו תוכניות.</p>
            ) : (
              <div className="space-y-2">
                {(() => {
                  const cmp = comparePlans(plans);
                  return (
                    <div className="text-xs bg-slate-50 rounded-lg px-3 py-2 mb-1">
                      <span className="font-medium">השוואה:</span> חוסרים —{" "}
                      {cmp.shortagesIdentical ? (
                        <span className="text-emerald-700">זהים בכל התוכניות</span>
                      ) : (
                        <span className="text-amber-700">שונים (ההבדלים מודגשים)</span>
                      )}{" "}
                      · פיזור מנהלות —{" "}
                      {cmp.mgrIdentical ? (
                        <span className="text-emerald-700">זהה בכל התוכניות</span>
                      ) : (
                        <span className="text-amber-700">שונה (ההבדלים מודגשים)</span>
                      )}
                    </div>
                  );
                })()}
                {plans.map((p, i) => {
                  const cmp = comparePlans(plans);
                  // group manager shifts by name, keeping each item's comparison key
                  const mgrByName: Record<string, { label: string; key: string }[]> = {};
                  for (const m of p.managers)
                    (mgrByName[m.name] ||= []).push({
                      label: `${DAY_NAMES[m.day_of_week]}-${m.slot === "morning" ? "בוקר" : "צהריים"}`,
                      key: `${m.name}|${m.day_of_week}|${m.slot}`,
                    });
                  return (
                    <div
                      key={i}
                      className={`border rounded-lg px-4 py-3 ${
                        i === 0 ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold">
                            תוכנית {i + 1}
                            {i === 0 && <span className="text-emerald-700 text-xs font-medium"> · הטובה ביותר</span>}
                          </div>
                          <div className="text-sm mt-0.5 flex gap-3">
                            <span className={p.shortage > 0 ? "text-red-600 font-medium" : "text-emerald-600"}>
                              חוסר {p.shortage}
                            </span>
                            <span className={p.surplus > 0 ? "text-amber-600 font-medium" : "text-slate-500"}>
                              עודף {p.surplus}
                            </span>
                            {p.missingPresence > 0 && (
                              <span className="text-red-600">בקרים ללא מנהלת {p.missingPresence}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => choosePlan(p)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
                        >
                          בחר תוכנית זו
                        </button>
                      </div>

                      {p.shortages.length > 0 && (
                        <div className="text-xs mt-2 flex flex-wrap items-center gap-1">
                          <span className="text-red-600 font-medium">היכן החוסרים:</span>
                          {p.shortages.map((s, j) => {
                            const diff = cmp.shKeyCount[`${s.day_of_week}|${s.start}|${s.end}`] < cmp.numPlans;
                            return (
                              <span
                                key={j}
                                className={`rounded px-1 ${diff ? "bg-amber-100 text-amber-800 font-medium" : "text-slate-600"}`}
                              >
                                {DAY_NAMES[s.day_of_week]} {s.start}–{s.end}
                                {s.shortage > 1 ? ` (×${s.shortage})` : ""}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      <button
                        onClick={() => togglePlanDetail(i)}
                        className="text-xs text-emerald-700 mt-2 hover:underline"
                      >
                        {planDetail.has(i) ? "▼ הסתר פיזור מנהלות" : "◀ פיזור מנהלות"}
                      </button>
                      {planDetail.has(i) && (
                        <div className="text-xs text-slate-600 mt-1 space-y-1">
                          {Object.entries(mgrByName).map(([name, items]) => (
                            <div key={name} className="flex flex-wrap items-center gap-1">
                              <b className="text-teal-700">{name}:</b>
                              {items.map((it, j) => {
                                const diff = cmp.mgrKeyCount[it.key] < cmp.numPlans;
                                return (
                                  <span
                                    key={j}
                                    className={`rounded px-1 ${
                                      diff ? "bg-amber-100 text-amber-800 font-medium" : "bg-slate-100"
                                    }`}
                                  >
                                    {it.label}
                                  </span>
                                );
                              })}
                            </div>
                          ))}
                          {Object.keys(mgrByName).length === 0 && <span className="text-slate-400">אין שיבוצי מנהלות</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={() => setPlans(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

function ConstraintsPanel({
  bundle,
  staff,
  onChange,
}: {
  bundle: WeekBundle;
  staff: Staff[];
  onChange: () => void;
}) {
  const start = bundle.week.start_date;
  const [staffId, setStaffId] = useState<number | "">("");
  const [offset, setOffset] = useState(0);
  const [direction, setDirection] = useState<"block" | "available">("block");
  const [whole, setWhole] = useState(true); // regular: whole day
  const [from, setFrom] = useState("08:00");
  const [to, setTo] = useState("13:00");
  const [mgrScope, setMgrScope] = useState<"full" | "morning" | "afternoon">("morning"); // manager
  const [note, setNote] = useState("");

  const selected = staff.find((s) => s.id === staffId);
  const isManager = selected?.type === "manager";

  async function add() {
    if (!staffId) return;
    let payload: Partial<Constraint> = {
      staff_id: Number(staffId),
      date: addDaysISO(start, offset),
      note: note || null,
    };
    if (isManager) {
      // managers: block OR available, scoped by morning / afternoon / whole day
      const map = { full: [null, null], morning: ["08:00", "13:00"], afternoon: ["13:00", "16:00"] } as const;
      const [s, e] = map[mgrScope];
      payload = { ...payload, direction, start_time: s, end_time: e };
    } else {
      payload = {
        ...payload,
        direction,
        start_time: whole ? null : from,
        end_time: whole ? null : to,
      };
    }
    await api.addConstraint(bundle.week.id, payload);
    setNote("");
    onChange();
  }
  const staffName = (id: number) => staff.find((s) => s.id === id)?.name || `#${id}`;

  function dirBtn(value: "block" | "available", label: string, active: string) {
    return (
      <button
        onClick={() => setDirection(value)}
        className={`px-2 py-1.5 rounded-lg text-sm border ${
          direction === value ? active : "border-slate-300 text-slate-600"
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-bold">אילוצים וזמינות</h3>
      <p className="text-xs text-slate-400 mb-3">מה אי אפשר (🚫) ומה אפשר (✅) — לכל אשת צוות, ביום ובשעות</p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">בחר אשת צוות…</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.type === "manager" ? "(מנהלת)" : ""}
            </option>
          ))}
        </select>
        <select
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          value={offset}
          onChange={(e) => setOffset(Number(e.target.value))}
        >
          {DAY_NAMES.map((n, i) => (
            <option key={i} value={i}>
              {n} {formatDate(addDaysISO(start, i))}
            </option>
          ))}
        </select>

        {isManager ? (
          // managers: block OR available, scoped by morning / afternoon / whole day
          <>
            {dirBtn("block", "🚫 לא זמינה", "border-red-500 bg-red-50 text-red-700")}
            {dirBtn("available", "✅ זמינה", "border-emerald-500 bg-emerald-50 text-emerald-700")}
            <select
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
              value={mgrScope}
              onChange={(e) => setMgrScope(e.target.value as typeof mgrScope)}
            >
              <option value="morning">בוקר (08:00–13:00)</option>
              <option value="afternoon">צהריים (13:00–16:00)</option>
              <option value="full">יום שלם</option>
            </select>
          </>
        ) : (
          // regulars: direction + whole-day / exact hours
          <>
            {dirBtn("block", "🚫 לא זמינה", "border-red-500 bg-red-50 text-red-700")}
            {dirBtn("available", "✅ זמינה", "border-emerald-500 bg-emerald-50 text-emerald-700")}
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
              יום שלם
            </label>
            {!whole && (
              <>
                <input
                  type="time"
                  className="border border-slate-300 rounded px-2 py-1 text-sm"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <span className="text-slate-400">–</span>
                <input
                  type="time"
                  className="border border-slate-300 rounded px-2 py-1 text-sm"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </>
            )}
          </>
        )}

        <input
          placeholder="הערה"
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-24"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          onClick={add}
          disabled={!staffId}
          className="bg-emerald-600 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
        >
          הוסף
        </button>
      </div>

      {bundle.constraints.length === 0 ? (
        <p className="text-sm text-slate-400">אין אילוצים או זמינות לשבוע זה.</p>
      ) : (
        <ul className="text-sm divide-y divide-slate-100">
          {bundle.constraints.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-1.5">
              <span>
                <span className={c.direction === "available" ? "text-emerald-700" : "text-red-600"}>
                  {c.direction === "available" ? "✅" : "🚫"}
                </span>{" "}
                <b>{staffName(c.staff_id)}</b> · {DAY_NAMES[new Date(c.date + "T00:00:00Z").getUTCDay()]}{" "}
                {formatDate(c.date)} · {c.start_time ? `${c.start_time}–${c.end_time}` : "יום שלם"}
                {c.note ? ` · ${c.note}` : ""}
              </span>
              <button
                onClick={async () => {
                  await api.deleteConstraint(bundle.week.id, c.id);
                  onChange();
                }}
                className="text-red-600 hover:underline"
              >
                הסר
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Closures (holidays / black days)
// ---------------------------------------------------------------------------

function ClosuresPanel({ bundle, onChange }: { bundle: WeekBundle; onChange: () => void }) {
  const start = bundle.week.start_date;
  const [offset, setOffset] = useState(0);
  const [whole, setWhole] = useState(true);
  const [from, setFrom] = useState("08:00");
  const [to, setTo] = useState("13:00");
  const [reason, setReason] = useState("");

  async function add() {
    await api.addClosure(bundle.week.id, {
      date: addDaysISO(start, offset),
      start_time: whole ? null : from,
      end_time: whole ? null : to,
      reason: reason || null,
    });
    setReason("");
    onChange();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-bold">ימי חגים / סגירה</h3>
      <p className="text-xs text-slate-400 mb-3">ימים שהגן סגור — חגים או ימי בלת"מ (בלוז)</p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          value={offset}
          onChange={(e) => setOffset(Number(e.target.value))}
        >
          {DAY_NAMES.map((n, i) => (
            <option key={i} value={i}>
              {n} {formatDate(addDaysISO(start, i))}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
          יום שלם
        </label>
        {!whole && (
          <>
            <input
              type="time"
              className="border border-slate-300 rounded px-2 py-1 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-slate-400">–</span>
            <input
              type="time"
              className="border border-slate-300 rounded px-2 py-1 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </>
        )}
        <input
          placeholder="סיבה (חג / אירוע)"
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-24"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button onClick={add} className="bg-amber-500 text-white text-sm px-3 py-1.5 rounded-lg">
          הוסף
        </button>
      </div>
      {bundle.closures.length === 0 ? (
        <p className="text-sm text-slate-400">אין ימי חגים או סגירה לשבוע זה.</p>
      ) : (
        <ul className="text-sm divide-y divide-slate-100">
          {bundle.closures.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-1.5">
              <span>
                {formatDate(c.date)} · {c.start_time ? `${c.start_time}–${c.end_time}` : "יום שלם"}
                {c.reason ? ` · ${c.reason}` : ""}
              </span>
              <button
                onClick={async () => {
                  await api.deleteClosure(bundle.week.id, c.id);
                  onChange();
                }}
                className="text-red-600 hover:underline"
              >
                הסר
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule grid (coverage + shortages + manual shift editing)
// ---------------------------------------------------------------------------

function hhmmToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// preset background colors for day notes
const NOTE_COLORS = ["#fde68a", "#fecaca", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#fed7aa", "#f5d0fe"];

function ScheduleGrid({
  bundle,
  staff,
  staffName,
  locked,
  onChange,
}: {
  bundle: WeekBundle;
  staff: Staff[];
  staffName: (id: number) => string;
  locked: boolean;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterId, setFilterId] = useState<number | null>(null);
  const [fillDate, setFillDate] = useState<string | null>(null);
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [addingNote, setAddingNote] = useState<{ date: string; text: string; color: string } | null>(null);
  // promise-based reason prompt shown only after the week is locked/final.
  // 'remove' asks for a category (מחלה/חופשה/אחר); 'add' asks only for an optional note.
  const [reasonResolver, setReasonResolver] = useState<{
    fn: (r: ChangeReason | null) => void;
    mode: "add" | "remove";
  } | null>(null);
  const askReason = (mode: "add" | "remove"): Promise<ChangeReason | null> =>
    new Promise((resolve) => setReasonResolver({ fn: resolve, mode }));

  async function doRemove(aid: number) {
    if (locked) {
      const r = await askReason("remove");
      if (!r) return;
      await api.deleteAssignment(bundle.week.id, aid, r);
    } else {
      await api.deleteAssignment(bundle.week.id, aid);
    }
    onChange();
  }
  async function doAdd(payload: { staff_id: number; date: string; start_time: string; end_time: string; is_replacement?: number }) {
    if (locked) {
      const r = await askReason("add");
      if (!r) return false;
      await api.addAssignment(bundle.week.id, { ...payload, ...r });
    } else {
      await api.addAssignment(bundle.week.id, payload);
    }
    onChange();
    return true;
  }

  const hasSchedule = bundle.assignments.length > 0;
  const totalShortage = bundle.coverage.reduce((s, d) => s + d.segments.reduce((q, x) => q + x.shortage, 0), 0);
  const totalSurplus = bundle.coverage.reduce((s, d) => s + d.segments.reduce((q, x) => q + x.surplus, 0), 0);

  const staffById = (id: number) => staff.find((s) => s.id === id);
  const isManager = (id: number) => staffById(id)?.type === "manager";

  // manager weekly load vs quota -> "extra work" flag
  const managerLoad: Record<number, { morning: number; afternoon: number; mq: number; aq: number; extra: number }> = {};
  for (const m of staff.filter((s) => s.type === "manager")) {
    const morn = new Set<string>();
    const aft = new Set<string>();
    for (const a of bundle.assignments.filter((x) => x.staff_id === m.id)) {
      const s = hhmmToMin(a.start_time);
      const e = hhmmToMin(a.end_time);
      if (s < 13 * 60 && e > 8 * 60) morn.add(a.date); // intersects morning 08-13
      if (s < 16 * 60 && e > 13 * 60) aft.add(a.date); // intersects afternoon 13-16
    }
    const extra = Math.max(0, morn.size - m.morning_quota) + Math.max(0, aft.size - m.afternoon_quota);
    managerLoad[m.id] = { morning: morn.size, afternoon: aft.size, mq: m.morning_quota, aq: m.afternoon_quota, extra };
  }
  const extraManagers = Object.keys(managerLoad)
    .map(Number)
    .filter((id) => managerLoad[id].extra > 0);

  const byDate: Record<string, Assignment[]> = {};
  for (const a of bundle.assignments) (byDate[a.date] ||= []).push(a);

  const notesByDate: Record<string, typeof bundle.notes> = {};
  for (const n of bundle.notes) (notesByDate[n.date] ||= []).push(n);

  async function saveNote() {
    if (!addingNote || !addingNote.text.trim()) return;
    await api.addNote(bundle.week.id, { date: addingNote.date, text: addingNote.text.trim(), color: addingNote.color });
    setAddingNote(null);
    onChange();
  }
  async function removeNote(noteId: number) {
    await api.deleteNote(bundle.week.id, noteId);
    onChange();
  }

  function toggleExpand(date: string) {
    setExpanded((p) => {
      const n = new Set(p);
      n.has(date) ? n.delete(date) : n.add(date);
      return n;
    });
  }

  // a clickable, styled staff name (managers bold+teal; over-quota managers red)
  function NameTag({ id, hours }: { id: number; hours?: string }) {
    const mgr = isManager(id);
    const over = (managerLoad[id]?.extra ?? 0) > 0;
    return (
      <button
        onClick={() => setFilterId(filterId === id ? null : id)}
        title={over ? "עומס מעבר למכסה השבוע" : "סנן לפי אשת צוות זו"}
        className={`hover:underline ${mgr ? "font-bold text-teal-700" : "text-slate-700"} ${over ? "!text-red-600" : ""}`}
      >
        {staffName(id)}
        {over ? " ⚠️" : ""}
        {hours ? <span className="font-normal text-slate-400 text-xs"> {hours}</span> : null}
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 print-area">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="font-bold">
          הלו"ז השבועי
          {locked && (
            <span className="mr-2 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full align-middle">
              מאושר
            </span>
          )}
        </h3>
        {hasSchedule && (
          <div className="flex items-center gap-3 text-sm font-medium">
            {totalShortage > 0 && <span className="text-red-600">⚠️ חוסר: {totalShortage}</span>}
            {totalSurplus > 0 && <span className="text-amber-600">▲ עודף: {totalSurplus}</span>}
            {totalShortage === 0 && totalSurplus === 0 && <span className="text-emerald-600">✓ איוש מדויק</span>}
          </div>
        )}
      </div>

      {/* manager over-quota banner */}
      {hasSchedule && extraManagers.length > 0 && (
        <div className="mb-3 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700">
          ⚠️ עומס מעבר למכסה השבוע:{" "}
          {extraManagers
            .map((id) => {
              const v = managerLoad[id];
              const parts: string[] = [];
              if (v.morning > v.mq) parts.push(`+${v.morning - v.mq} בוקר`);
              if (v.afternoon > v.aq) parts.push(`+${v.afternoon - v.aq} צהריים`);
              return `${staffName(id)} (${parts.join(", ")})`;
            })
            .join(" · ")}
        </div>
      )}

      {/* person filter chip */}
      {filterId !== null && (
        <div className="mb-3 flex items-center gap-2 text-sm no-print">
          <span className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-full px-3 py-1">
            מציג רק: <b>{staffName(filterId)}</b>
          </span>
          <button onClick={() => setFilterId(null)} className="text-slate-500 hover:underline">
            הצג הכל ✕
          </button>
        </div>
      )}

      {!hasSchedule && (
        <p className="text-slate-500 text-sm mb-3 no-print">
          אין לו"ז עדיין — אפשר להוסיף הערות לימים למטה, ולחץ "ייצר לו\"ז" לשיבוץ. ההערות לא נמחקות ביצירת לו"ז.
        </p>
      )}
      {hasSchedule && filterId === null && (
        <p className="text-xs text-slate-500 mb-3 no-print">
          לחץ על "משמרות" בכל יום כדי להציג/להסתיר את הרשימה · לחץ על שם כדי לראות את כל השבוע של אותה אשת צוות ·{" "}
          <span className="font-bold text-teal-700">מנהלות מודגשות</span>
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 print-grid">
        {bundle.coverage.map((d) => {
              const dayShort = d.segments.reduce((s, x) => s + x.shortage, 0);
              const daySurplus = d.segments.reduce((s, x) => s + x.surplus, 0);
              const dayAssignments = (byDate[d.date] || [])
                .slice()
                .sort((a, b) => a.start_time.localeCompare(b.start_time));

              // FILTER MODE: just this person's shift for the day
              if (filterId !== null) {
                const mine = dayAssignments.filter((a) => a.staff_id === filterId);
                return (
                  <div
                    key={d.date}
                    className={`rounded-lg border ${d.closed ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}
                  >
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="font-bold">
                        {DAY_NAMES[d.day_of_week]} <span className="text-slate-400 font-normal">{formatDate(d.date)}</span>
                      </span>
                      {d.closed && <span className="text-xs text-amber-700">סגור</span>}
                    </div>
                    {!d.closed && (
                      <div className="px-3 pb-2 text-base font-medium">
                        {mine.length ? (
                          mine.map((a) => `${a.start_time}–${a.end_time}`).join(", ")
                        ) : (
                          <span className="text-slate-400 text-sm font-normal">לא עובדת</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              }

              const isOpen = expanded.has(d.date);
              return (
                <div
                  key={d.date}
                  className={`rounded-lg border ${d.closed ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}
                >
                  <div className="w-full px-3 py-2 flex items-center justify-between">
                    <span className="font-bold">
                      {DAY_NAMES[d.day_of_week]} <span className="text-slate-400 font-normal">{formatDate(d.date)}</span>
                    </span>
                    <span className="text-xs font-medium">
                      {d.closed ? (
                        <span className="text-amber-700">סגור</span>
                      ) : !hasSchedule ? null : dayShort > 0 ? (
                        <span className="text-red-600">חסר {dayShort}</span>
                      ) : daySurplus > 0 ? (
                        <span className="text-amber-600">עודף {daySurplus}</span>
                      ) : (
                        <span className="text-emerald-600">✓ מלא</span>
                      )}
                    </span>
                  </div>

                  {/* day notes — colored, survive schedule regeneration */}
                  <div className="px-3 py-2 border-t border-slate-100 space-y-1">
                    {(notesByDate[d.date] || []).map((n) => (
                      <div
                        key={n.id}
                        style={{ background: n.color || NOTE_COLORS[0] }}
                        className="rounded px-2 py-1 text-sm font-medium text-slate-800 flex items-start justify-between gap-2"
                      >
                        <span className="whitespace-pre-wrap break-words">{n.text}</span>
                        <button
                          onClick={() => removeNote(n.id)}
                          className="text-slate-600 hover:text-red-700 text-xs no-print shrink-0"
                          title="הסר הערה"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {addingNote?.date === d.date ? (
                      <div className="no-print space-y-1">
                        <input
                          autoFocus
                          value={addingNote.text}
                          onChange={(e) => setAddingNote({ ...addingNote, text: e.target.value })}
                          placeholder="טקסט ההערה"
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        />
                        <div className="flex items-center gap-1">
                          {NOTE_COLORS.map((c) => (
                            <button
                              key={c}
                              onClick={() => setAddingNote({ ...addingNote, color: c })}
                              style={{ background: c }}
                              className={`w-5 h-5 rounded-full border ${
                                addingNote.color === c ? "ring-2 ring-offset-1 ring-slate-500" : "border-slate-300"
                              }`}
                            />
                          ))}
                          <button onClick={saveNote} className="bg-emerald-600 text-white text-xs px-2 py-1 rounded ms-auto">
                            שמור
                          </button>
                          <button onClick={() => setAddingNote(null)} className="text-slate-500 text-xs px-1">
                            ביטול
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingNote({ date: d.date, text: "", color: NOTE_COLORS[0] })}
                        className="text-xs text-emerald-700 hover:underline no-print"
                      >
                        + הערה
                      </button>
                    )}
                  </div>

                  {hasSchedule && !d.closed && (
                    <div className="border-t border-slate-100">
                      <table className="w-full text-sm">
                        <tbody>
                          {d.segments.map((seg, i) => (
                            <tr
                              key={i}
                              className={`border-t border-slate-50 ${
                                seg.shortage > 0 ? "bg-red-50" : seg.surplus > 0 ? "bg-amber-50" : ""
                              }`}
                            >
                              <td className="px-3 py-1.5 whitespace-nowrap align-top text-slate-600">
                                {seg.start}–{seg.end}
                              </td>
                              <td className="px-2 py-1.5 align-top">
                                <span className="whitespace-nowrap">
                                  <span
                                    className={`font-bold ${
                                      seg.shortage > 0
                                        ? "text-red-600"
                                        : seg.surplus > 0
                                        ? "text-amber-600"
                                        : "text-emerald-700"
                                    }`}
                                  >
                                    יש {seg.assigned}
                                  </span>
                                  <span className="text-slate-400"> · צריך {seg.required}</span>
                                  {seg.shortage > 0 && (
                                    <span className="text-red-600 font-medium"> · חסר {seg.shortage}</span>
                                  )}
                                  {seg.surplus > 0 && (
                                    <span className="text-amber-600 font-medium"> · עודף {seg.surplus}</span>
                                  )}
                                </span>
                                {seg.staff.length > 0 && (
                                  <div className="text-sm text-slate-600 mt-0.5 leading-snug flex flex-wrap gap-x-2 gap-y-0.5">
                                    {seg.staff.map((s) => (
                                      <NameTag key={s.id} id={s.id} />
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {dayShort > 0 && (
                        <div className="px-3 py-2 border-t border-slate-100 no-print">
                          <button
                            onClick={() => setFillDate(d.date)}
                            className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5"
                          >
                            ✨ מלא חוסרים ({dayShort})
                          </button>
                        </div>
                      )}

                      <div className="px-3 py-2 border-t border-slate-100">
                        <button
                          onClick={() => toggleExpand(d.date)}
                          className="w-full flex items-center justify-between text-xs font-medium text-slate-500 mb-1 no-print"
                        >
                          <span>משמרות ({dayAssignments.length})</span>
                          <span className="text-slate-400">{isOpen ? "▼ הסתר" : "◀ הצג"}</span>
                        </button>
                        <div className={isOpen ? "" : "hidden print:block"}>
                        {dayAssignments.length === 0 ? (
                          <p className="text-xs text-slate-400">—</p>
                        ) : (
                          <ul className="space-y-0.5">
                            {dayAssignments.map((a) => (
                              <li key={a.id} className="flex items-center justify-between text-base">
                                <span>
                                  <NameTag id={a.staff_id} hours={`${a.start_time}–${a.end_time}`} />
                                  {a.is_replacement ? (
                                    <span className="text-xs text-blue-600"> · החלפה</span>
                                  ) : a.source === "manual" ? (
                                    <span className="text-xs text-emerald-600"> · ידני</span>
                                  ) : null}
                                </span>
                                <button
                                  onClick={() => doRemove(a.id)}
                                  className="text-red-500 hover:text-red-700 text-xs no-print px-1"
                                  title={locked ? "הסר משמרת (יידרש לציין סיבה)" : "הסר משמרת"}
                                >
                                  ✕
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        {addingDate === d.date ? (
                          <AddShiftForm
                            staff={staff}
                            onCancel={() => setAddingDate(null)}
                            onAdd={async (staffId, s, e) => {
                              const ok = await doAdd({ staff_id: staffId, date: d.date, start_time: s, end_time: e });
                              if (ok) setAddingDate(null);
                            }}
                          />
                        ) : (
                          <button
                            onClick={() => setAddingDate(d.date)}
                            className="mt-1 text-xs text-emerald-700 hover:underline no-print"
                          >
                            + הוסף משמרת
                          </button>
                        )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

      {fillDate && (
        <DayFillModal
          weekId={bundle.week.id}
          date={fillDate}
          onClose={() => setFillDate(null)}
          onAssign={(sid, s, e) => doAdd({ staff_id: sid, date: fillDate, start_time: s, end_time: e, is_replacement: 1 })}
        />
      )}

      {reasonResolver && (
        <ReasonModal
          mode={reasonResolver.mode}
          onCancel={() => {
            reasonResolver.fn(null);
            setReasonResolver(null);
          }}
          onConfirm={(r) => {
            reasonResolver.fn(r);
            setReasonResolver(null);
          }}
        />
      )}
    </div>
  );
}

// Fill all (or selected) shortages of a single day without leaving the page.
// Pick which short segments to fill -> one staff member is assigned to the combined
// time span. The dialog refreshes after each assignment so you can keep filling.
function DayFillModal({
  weekId,
  date,
  onClose,
  onAssign,
}: {
  weekId: number;
  date: string;
  onClose: () => void;
  onAssign: (staffId: number, start: string, end: string) => Promise<boolean>;
}) {
  const [segs, setSegs] = useState<CoverageSegment[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cands, setCands] = useState<Replacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [dow, setDow] = useState(0);
  const [tab, setTab] = useState<"regular" | "manager">("regular");
  const [mgrSlot, setMgrSlot] = useState<"morning" | "afternoon">("morning");

  async function load() {
    setLoading(true);
    const b = await api.getWeek(weekId);
    const day = b.coverage.find((d) => d.date === date);
    const short = (day?.segments || []).filter((s) => s.shortage > 0);
    setDow(day?.day_of_week ?? 0);
    setSegs(short);
    setSel(new Set(short.map((_, i) => i))); // default: all selected
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const isFri = dow === 5;
  const slot = isFri ? "morning" : mgrSlot; // Friday has no afternoon block

  // regular tab: union span of the selected shortage segments
  const selSegs = segs.filter((_, i) => sel.has(i));
  const spanStart = selSegs.length ? selSegs.map((s) => s.start).sort()[0] : null;
  const spanEnd = selSegs.length ? selSegs.map((s) => s.end).sort().slice(-1)[0] : null;
  // manager tab: the morning/afternoon block with the managers' defined hours
  const mgrWin = slot === "morning" ? { start: "08:00", end: isFri ? "12:00" : "13:00" } : { start: "13:00", end: "16:00" };

  const winStart = tab === "manager" ? mgrWin.start : spanStart;
  const winEnd = tab === "manager" ? mgrWin.end : spanEnd;
  // does the chosen manager block still have a shortage? (only then is there a reason to add one)
  const blockShort = tab === "manager" && segs.some((s) => s.start >= mgrWin.start && s.end <= mgrWin.end);

  useEffect(() => {
    const canQuery = tab === "manager" ? blockShort : !!(winStart && winEnd);
    if (winStart && winEnd && canQuery) {
      api
        .getReplacements(weekId, date, winStart, winEnd)
        .then((list) => setCands(list.filter((r) => (tab === "manager" ? r.type === "manager" : r.type !== "manager"))));
    } else {
      setCands([]);
    }
  }, [winStart, winEnd, tab, blockShort]);

  function toggle(i: number) {
    setSel((p) => {
      const n = new Set(p);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }

  async function assign(r: Replacement) {
    if (!winStart || !winEnd) return;
    const ok = await onAssign(r.staff_id, winStart, winEnd);
    if (ok) await load();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center p-4 overflow-auto z-50 no-print">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h3 className="text-lg font-bold mb-1">
          מילוי חוסרים — {DAY_NAMES[dow]} {formatDate(date)}
        </h3>
        {loading ? (
          <p className="text-slate-500 text-sm my-4">טוען…</p>
        ) : (
          <>
            <div className="flex gap-1 mb-3">
              {(
                [
                  ["regular", "קבועה"],
                  ["manager", "מנהלת"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium ${
                    tab === k ? "bg-emerald-600 text-white" : "border border-slate-300 text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "regular" ? (
              segs.length === 0 ? (
                <p className="text-emerald-600 text-sm my-2">✓ אין חוסרים נותרים ליום זה</p>
              ) : (
                <>
                  <p className="text-sm text-slate-500 mb-2">
                    סמן אילו פרוסות למלא, ואז בחר עובדת שתשובץ <b>לכל הטווח שנבחר בבת אחת</b>:
                  </p>
                  <div className="space-y-1 mb-3">
                    {segs.map((s, i) => (
                      <label key={i} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} />
                        <span>
                          {s.start}–{s.end} · <span className="text-red-600">חסר {s.shortage}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )
            ) : (
              <>
                <p className="text-sm text-slate-500 mb-2">בחר משמרת, ואז מנהלת מהרשימה:</p>
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setMgrSlot("morning")}
                    className={`flex-1 py-2 rounded-lg border text-sm ${
                      slot === "morning" ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-300"
                    }`}
                  >
                    בוקר ({isFri ? "08:00–12:00" : "08:00–13:00"})
                  </button>
                  {!isFri && (
                    <button
                      onClick={() => setMgrSlot("afternoon")}
                      className={`flex-1 py-2 rounded-lg border text-sm ${
                        slot === "afternoon" ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-300"
                      }`}
                    >
                      צהריים (13:00–16:00)
                    </button>
                  )}
                </div>
              </>
            )}

            {winStart && (
              <div className="text-sm mb-2 bg-slate-50 rounded px-2 py-1">
                ישובץ ל: <b>{winStart}–{winEnd}</b>
              </div>
            )}

            <div className="border-t border-slate-100 pt-2">
              {tab === "manager" && !blockShort ? (
                <p className="text-sm text-emerald-600">אין חוסר במשמרת זו — אין צורך להוסיף מנהלת.</p>
              ) : cands.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {tab === "manager" ? "אין מנהלות זמינות למשמרת זו." : "אין עובדות זמינות לטווח זה."}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 max-h-60 overflow-auto">
                  {cands.map((r) => (
                    <li key={r.staff_id} className="flex items-center justify-between py-2">
                      <span>
                        <b className={r.type === "manager" ? "text-teal-700" : ""}>{r.name}</b>
                        <div className="text-xs text-slate-500">{r.reason}</div>
                      </span>
                      <button
                        onClick={() => assign(r)}
                        disabled={!winStart}
                        className="bg-emerald-600 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
                      >
                        שבץ
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}

function AddShiftForm({
  staff,
  onCancel,
  onAdd,
}: {
  staff: Staff[];
  onCancel: () => void;
  onAdd: (staffId: number, start: string, end: string) => void;
}) {
  const [staffId, setStaffId] = useState<number | "">("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:00");

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 no-print">
      <select
        className="border border-slate-300 rounded px-2 py-1 text-sm"
        value={staffId}
        onChange={(e) => setStaffId(e.target.value ? Number(e.target.value) : "")}
      >
        <option value="">אשת צוות…</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        type="time"
        className="border border-slate-300 rounded px-1.5 py-1 text-sm"
        value={start}
        onChange={(e) => setStart(e.target.value)}
      />
      <span className="text-slate-400">–</span>
      <input
        type="time"
        className="border border-slate-300 rounded px-1.5 py-1 text-sm"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
      />
      <button
        onClick={() => staffId && onAdd(Number(staffId), start, end)}
        className="bg-emerald-600 text-white text-xs px-2 py-1 rounded"
      >
        שמור
      </button>
      <button onClick={onCancel} className="text-slate-500 text-xs px-1">
        ביטול
      </button>
    </div>
  );
}

// Reason prompt shown when editing a LOCKED (approved) week. The change is logged.
// 'remove' = pick a category (why removed); 'add' = just an optional note.
function ReasonModal({
  mode,
  onConfirm,
  onCancel,
}: {
  mode: "add" | "remove";
  onConfirm: (r: ChangeReason) => void;
  onCancel: () => void;
}) {
  const [cat, setCat] = useState<ReasonCategory>("sick");
  const [note, setNote] = useState("");
  const isRemove = mode === "remove";
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 overflow-auto z-[60] no-print">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h3 className="text-lg font-bold mb-1">{isRemove ? "סיבת ההסרה" : "הוספת שיבוץ"}</h3>
        <p className="text-sm text-slate-500 mb-4">
          {isRemove
            ? 'הלו"ז מאושר — בחר/י סיבה (תירשם ביומן השינויים).'
            : 'הלו"ז מאושר — אפשר להוסיף הערה (לא חובה). יירשם ביומן השינויים.'}
        </p>
        {isRemove && (
          <div className="flex gap-2 mb-3">
            {(["sick", "vacation", "other"] as ReasonCategory[]).map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`flex-1 py-2 rounded-lg border text-sm ${
                  cat === c ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-300"
                }`}
              >
                {REASON_LABELS[c]}
              </button>
            ))}
          </div>
        )}
        <input
          placeholder={isRemove && cat === "other" ? "פרט/י סיבה" : "הערה (לא חובה)"}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">
            ביטול
          </button>
          <button
            onClick={() =>
              onConfirm(isRemove ? { reason_category: cat, reason_note: note || null } : { reason_note: note || null })
            }
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium"
          >
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}
