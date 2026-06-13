// Sample-data seeder for the kindergarten scheduler.
// Run with: node scripts/seed-sample.mjs   (the app must be running on :3100)
// Creates a realistic staff roster, a week with a constraint + a holiday, and generates a schedule.

const BASE = process.env.BASE || "http://localhost:3100/api";

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}`);
  return r.json();
}
async function del(path) {
  await fetch(BASE + path, { method: "DELETE" });
}

// Sun-Thu (days 0-4) availability with given hours
const weekdays = (start, end) =>
  [0, 1, 2, 3, 4].map((d) => ({ day_of_week: d, start_time: start, end_time: end }));
// subset of days
const someDays = (days, start, end) =>
  days.map((d) => ({ day_of_week: d, start_time: start, end_time: end }));

async function main() {
  // --- clean slate: remove all existing staff and weeks ---
  const existingStaff = await (await fetch(BASE + "/staff")).json();
  for (const s of existingStaff) await del(`/staff/${s.id}`);
  const existingWeeks = await (await fetch(BASE + "/weeks")).json();
  for (const w of existingWeeks) await del(`/weeks/${w.id}`);

  // Friday availability row helper (day 5)
  const friday = (start, end) => ({ day_of_week: 5, start_time: start, end_time: end });

  // --- regular staff, STAGGERED so they cover the edges exactly and leave a small
  //     mid-day gap (morning 9/10, afternoon 7/8) for the managers to fill precisely ---
  // 2 open at 07:30, a 3rd at 07:45; closers stay to 16:15/16:30; 2 are morning-only.
  await post("/staff", { name: "שירה", type: "regular", friday_mode: "morning", availability: weekdays("07:30", "16:30") }); // opener + last closer + Fri
  await post("/staff", { name: "יעל", type: "regular", friday_mode: "morning", availability: weekdays("07:30", "16:00") }); // opener + Fri
  await post("/staff", { name: "נועה", type: "regular", availability: [...weekdays("07:45", "16:15"), friday("08:00", "12:00")] }); // early + closer + Fri
  await post("/staff", { name: "מיכל", type: "regular", availability: [...weekdays("08:00", "16:00"), friday("08:00", "12:00")] });
  await post("/staff", { name: "רותם", type: "regular", availability: [...weekdays("08:00", "16:00"), friday("08:00", "12:00")] });
  await post("/staff", { name: "ליאת", type: "regular", availability: [...weekdays("08:00", "16:00"), friday("08:00", "12:00")] });
  // biweekly-Friday staff: anchor a week earlier => she is OFF this Friday (demonstrates the rotation)
  await post("/staff", { name: "קרן", type: "regular", friday_mode: "biweekly", friday_anchor: "2026-06-12", availability: weekdays("08:00", "16:00") });
  await post("/staff", { name: "הילה", type: "regular", friday_mode: "none", availability: weekdays("08:00", "13:00") }); // morning only
  await post("/staff", { name: "אורית", type: "regular", friday_mode: "none", availability: weekdays("08:00", "13:00") }); // morning only

  // --- managers (hours-only): they fill the daily mid-day gaps exactly, no overstaffing ---
  await post("/staff", { name: "חן", type: "manager", morning_quota: 3, afternoon_quota: 3 });
  await post("/staff", { name: "עדי", type: "manager", morning_quota: 3, afternoon_quota: 3 });

  // --- a sample week (2026-06-14 is a Sunday) ---
  const week = await post("/weeks", { start_date: "2026-06-14" });
  const staff = await (await fetch(BASE + "/staff")).json();
  const byName = Object.fromEntries(staff.map((s) => [s.name, s.id]));

  // constraint on Tuesday (2026-06-16): שירה (an opener) is off all day.
  // -> the 07:30 opening drops below requirement, a gap managers can't fill (they start 08:00),
  //    so it stays red for you to resolve via "הצע החלפה" (גלית/רוני are free that day).
  await post(`/weeks/${week.id}/constraints`, { staff_id: byName["שירה"], date: "2026-06-16", note: "חופש" });

  // holiday: Thursday closed
  await post(`/weeks/${week.id}/closures`, { date: "2026-06-18", reason: "חג" });

  // generate the schedule
  await post(`/weeks/${week.id}/generate`, {});

  console.log(`Seeded ${staff.length} staff + week #${week.id} (2026-06-14) and generated a schedule.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
