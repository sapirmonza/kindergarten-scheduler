// Pure schedule optimizer (no DB / no I/O) so it can be unit-tested in isolation.
//
// Degrees of freedom:
//   1. Each REGULAR works exactly `target` days out of her available days (the algorithm picks which).
//      When she works a day, she works the hours defined for that day.
//   2. Each MANAGER works up to her morning/afternoon quota, on days she is available.
//
// Objective (lexicographic — earlier terms dominate):
//   1. mornings without a manager present (HARD rule: a manager every morning if one is available)
//   2. total shortage   (kids under-covered)
//   3. total surplus    (extra staff beyond need)
//   4. "split" afternoons — a manager afternoon NOT paired with her own morning that day
//       (soft preference: a manager who works a morning gets first dibs on that afternoon)
//   5. manager-load imbalance (tiny tiebreak; spreads shifts)
//
// Method: several randomized starts -> hill-climb to a local optimum -> dedupe -> return the best K.

export type OptSegment = { start: number; end: number; required: number };
export type OptDay = {
  date: string;
  morningStart: number;
  morningEnd: number;
  afternoonStart: number;
  afternoonEnd: number;
  hasAfternoon: boolean; // false on Friday
  morningPresence: boolean; // does this day require a manager in the morning?
  segments: OptSegment[];
};
export type OptRegular = {
  id: number;
  target: number; // days/week she works
  avail: { date: string; start: number; end: number }[];
};
export type OptManager = {
  id: number;
  morningQuota: number;
  afternoonQuota: number;
  availMornings: string[];
  availAfternoons: string[];
};
// "required" pre-placed shifts that ALWAYS appear and count toward coverage (strongest priority)
export type OptForced = { staff_id: number; date: string; start: number; end: number; isManager: boolean };
export type OptInput = { days: OptDay[]; regulars: OptRegular[]; managers: OptManager[]; forced: OptForced[] };

export type OptShift = { staff_id: number; date: string; start: number; end: number };
export type OptPlan = {
  shifts: OptShift[];
  shortage: number;
  surplus: number;
  missingPresence: number;
};

type Solution = {
  regDays: Map<number, string[]>; // regular id -> dates she works
  mgrShifts: { mid: number; date: string; slot: "morning" | "afternoon" }[];
};

type Cost = [number, number, number, number, number]; // [missingPresence, shortage, surplus, split, imbalance]

function lexLess(a: Cost, b: Cost): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

// ---------------------------------------------------------------------------

export function buildPlans(input: OptInput, k = 3, restarts = 10): OptPlan[] {
  const dayByDate = new Map(input.days.map((d) => [d.date, d]));
  const regById = new Map(input.regulars.map((r) => [r.id, r]));
  const mgrById = new Map(input.managers.map((m) => [m.id, m]));

  const effTarget = (r: OptRegular) => Math.min(r.target, r.avail.length);

  // ---- evaluate a solution -> cost tuple ----
  function evaluate(sol: Solution): Cost {
    let shortage = 0;
    let surplus = 0;
    let missingPresence = 0;

    // gather, per date, the intervals present (forced + regulars + managers)
    const byDate = new Map<string, { start: number; end: number; isManager: boolean }[]>();
    for (const d of input.days) byDate.set(d.date, []);

    for (const f of input.forced) byDate.get(f.date)?.push({ start: f.start, end: f.end, isManager: f.isManager });

    for (const r of input.regulars) {
      const dates = sol.regDays.get(r.id) || [];
      for (const date of dates) {
        const a = r.avail.find((x) => x.date === date);
        if (a) byDate.get(date)?.push({ start: a.start, end: a.end, isManager: false });
      }
    }
    for (const s of sol.mgrShifts) {
      const d = dayByDate.get(s.date)!;
      if (s.slot === "morning") byDate.get(s.date)?.push({ start: d.morningStart, end: d.morningEnd, isManager: true });
      else byDate.get(s.date)?.push({ start: d.afternoonStart, end: d.afternoonEnd, isManager: true });
    }

    for (const d of input.days) {
      const intervals = byDate.get(d.date)!;
      for (const seg of d.segments) {
        let count = 0;
        for (const iv of intervals) if (iv.start <= seg.start && iv.end >= seg.end) count++;
        if (count < seg.required) shortage += seg.required - count;
        else if (count > seg.required) surplus += count - seg.required;
      }
      if (d.morningPresence) {
        const hasMgr = intervals.some((iv) => iv.isManager && iv.start <= d.morningStart && iv.end >= d.morningEnd);
        if (!hasMgr) missingPresence++;
      }
    }

    // soft preference: an afternoon a manager works should ideally be on a day she also works
    // the morning (so a morning manager gets that afternoon). Count the unpaired afternoons.
    let split = 0;
    for (const s of sol.mgrShifts) {
      if (s.slot === "afternoon" && !sol.mgrShifts.some((x) => x.mid === s.mid && x.date === s.date && x.slot === "morning"))
        split++;
    }

    // manager load imbalance (sum of squares — convex, so it favors spreading)
    const load = new Map<number, number>();
    for (const s of sol.mgrShifts) load.set(s.mid, (load.get(s.mid) || 0) + 1);
    let imbalance = 0;
    for (const v of load.values()) imbalance += v * v;

    return [missingPresence, shortage, surplus, split, imbalance];
  }

  // ---- random initial solution ----
  function randomSolution(): Solution {
    const regDays = new Map<number, string[]>();
    for (const r of input.regulars) {
      const n = effTarget(r);
      const dates = r.avail.map((a) => a.date);
      shuffle(dates);
      regDays.set(r.id, dates.slice(0, n));
    }
    // random manager shifts (diverse starting points so restarts explore different basins)
    const mgrShifts: Solution["mgrShifts"] = [];
    for (const m of input.managers) {
      const morn = [...m.availMornings];
      shuffle(morn);
      const nM = Math.floor(Math.random() * (Math.min(m.morningQuota, morn.length) + 1));
      for (const date of morn.slice(0, nM)) mgrShifts.push({ mid: m.id, date, slot: "morning" });
      const aft = [...m.availAfternoons];
      shuffle(aft);
      const nA = Math.floor(Math.random() * (Math.min(m.afternoonQuota, aft.length) + 1));
      for (const date of aft.slice(0, nA)) mgrShifts.push({ mid: m.id, date, slot: "afternoon" });
    }
    return { regDays, mgrShifts };
  }

  // ---- neighbor moves ----
  function neighbors(sol: Solution): Solution[] {
    const out: Solution[] = [];

    // 1. regular day swaps (only flexible regulars)
    for (const r of input.regulars) {
      const target = effTarget(r);
      if (target >= r.avail.length) continue; // fixed — no choice
      const chosen = sol.regDays.get(r.id) || [];
      const chosenSet = new Set(chosen);
      const unchosen = r.avail.map((a) => a.date).filter((d) => !chosenSet.has(d));
      for (const c of chosen) {
        for (const u of unchosen) {
          const nd = new Map(sol.regDays);
          nd.set(
            r.id,
            chosen.map((x) => (x === c ? u : x))
          );
          out.push({ regDays: nd, mgrShifts: sol.mgrShifts });
        }
      }
    }

    // 2. manager add / remove (morning and afternoon are independent — a manager may work
    //    morning-only, afternoon-only, or both; the "same-day pairing" is only a soft preference
    //    handled in the cost function, not a hard constraint here).
    const ms = sol.mgrShifts;
    const hasShift = (mid: number, date: string, slot: "morning" | "afternoon") =>
      ms.some((s) => s.mid === mid && s.date === date && s.slot === slot);
    const slotCount = (mid: number, slot: "morning" | "afternoon") =>
      ms.filter((s) => s.mid === mid && s.slot === slot).length;

    for (const m of input.managers) {
      if (slotCount(m.id, "morning") < m.morningQuota) {
        for (const date of m.availMornings)
          if (!hasShift(m.id, date, "morning"))
            out.push({ regDays: sol.regDays, mgrShifts: [...ms, { mid: m.id, date, slot: "morning" }] });
      }
      if (slotCount(m.id, "afternoon") < m.afternoonQuota) {
        for (const date of m.availAfternoons)
          if (!hasShift(m.id, date, "afternoon"))
            out.push({ regDays: sol.regDays, mgrShifts: [...ms, { mid: m.id, date, slot: "afternoon" }] });
      }
    }
    for (let i = 0; i < ms.length; i++) {
      out.push({ regDays: sol.regDays, mgrShifts: ms.filter((_, j) => j !== i) });
    }

    // 3. MOVE a shift to another available day (same manager, same slot) — one atomic step,
    //    so e.g. "פליאת ראשון -> שישי" is reachable without an intermediate worse state.
    for (let i = 0; i < ms.length; i++) {
      const s = ms[i];
      const avail = s.slot === "morning" ? mgrById.get(s.mid)?.availMornings : mgrById.get(s.mid)?.availAfternoons;
      for (const date of avail || []) {
        if (date === s.date || hasShift(s.mid, date, s.slot)) continue;
        const next = ms.map((x, j) => (j === i ? { ...x, date } : x));
        out.push({ regDays: sol.regDays, mgrShifts: next });
      }
    }

    // 4. REASSIGN a shift to a different available manager (swap who covers a day/slot) — lets the
    //    freed manager's quota go elsewhere, enabling coordinated improvements.
    for (let i = 0; i < ms.length; i++) {
      const s = ms[i];
      for (const m of input.managers) {
        if (m.id === s.mid) continue;
        const avail = s.slot === "morning" ? m.availMornings : m.availAfternoons;
        if (!avail.includes(s.date)) continue;
        if (hasShift(m.id, s.date, s.slot)) continue;
        if (slotCount(m.id, s.slot) >= (s.slot === "morning" ? m.morningQuota : m.afternoonQuota)) continue;
        const next = ms.map((x, j) => (j === i ? { ...x, mid: m.id } : x));
        out.push({ regDays: sol.regDays, mgrShifts: next });
      }
    }

    return out;
  }

  function hillClimb(start: Solution): { sol: Solution; cost: Cost } {
    let sol = start;
    let cost = evaluate(sol);
    for (let guard = 0; guard < 1000; guard++) {
      let bestSol: Solution | null = null;
      let bestCost = cost;
      for (const n of neighbors(sol)) {
        const c = evaluate(n);
        if (lexLess(c, bestCost)) {
          bestSol = n;
          bestCost = c;
        }
      }
      if (!bestSol) break;
      sol = bestSol;
      cost = bestCost;
    }
    return { sol, cost };
  }

  // ---- run restarts, collect distinct local optima ----
  const results: { sol: Solution; cost: Cost; sig: string }[] = [];
  const sigOf = (sol: Solution): string => {
    const regs = [...sol.regDays.entries()]
      .map(([id, ds]) => `${id}:${[...ds].sort().join(",")}`)
      .sort()
      .join(";");
    const mgrs = sol.mgrShifts
      .map((s) => `${s.mid}|${s.date}|${s.slot}`)
      .sort()
      .join(";");
    return regs + "||" + mgrs;
  };

  for (let i = 0; i < restarts; i++) {
    const { sol, cost } = hillClimb(randomSolution());
    const sig = sigOf(sol);
    if (!results.some((r) => r.sig === sig)) results.push({ sol, cost, sig });
  }

  results.sort((a, b) => (lexLess(a.cost, b.cost) ? -1 : lexLess(b.cost, a.cost) ? 1 : 0));

  return results.slice(0, k).map(({ sol, cost }) => ({
    shifts: solutionToShifts(sol, input, dayByDate, regById, mgrById),
    missingPresence: cost[0],
    shortage: cost[1],
    surplus: cost[2],
  }));
}

function solutionToShifts(
  sol: Solution,
  input: OptInput,
  dayByDate: Map<string, OptDay>,
  regById: Map<number, OptRegular>,
  _mgrById: Map<number, OptManager>
): OptShift[] {
  const shifts: OptShift[] = [];
  for (const [rid, dates] of sol.regDays) {
    const r = regById.get(rid)!;
    for (const date of dates) {
      const a = r.avail.find((x) => x.date === date);
      if (a) shifts.push({ staff_id: rid, date, start: a.start, end: a.end });
    }
  }
  for (const s of sol.mgrShifts) {
    const d = dayByDate.get(s.date)!;
    if (s.slot === "morning") shifts.push({ staff_id: s.mid, date: s.date, start: d.morningStart, end: d.morningEnd });
    else shifts.push({ staff_id: s.mid, date: s.date, start: d.afternoonStart, end: d.afternoonEnd });
  }
  // required pre-placed shifts always appear in the output
  for (const f of input.forced) shifts.push({ staff_id: f.staff_id, date: f.date, start: f.start, end: f.end });
  return shifts;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
