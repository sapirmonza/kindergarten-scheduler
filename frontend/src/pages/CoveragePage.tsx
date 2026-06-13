import { useEffect, useState } from "react";
import { api, type Coverage } from "../api";

type Row = Omit<Coverage, "id">;

export default function CoveragePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    const data = await api.getCoverage();
    setRows(data.map(({ id, ...r }) => r));
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  function update(idx: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setSaved(false);
  }
  function addRow(day_type: Row["day_type"]) {
    setRows((rs) => [...rs, { day_type, start_time: "08:00", end_time: "13:00", required_count: 1 }]);
    setSaved(false);
  }
  function removeRow(idx: number) {
    setRows((rs) => rs.filter((_, i) => i !== idx));
    setSaved(false);
  }
  async function save() {
    await api.saveCoverage(rows);
    setSaved(true);
  }

  if (loading) return <p className="text-slate-500">טוען…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">דרישות כיסוי</h2>
        <button
          onClick={save}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          שמירה
        </button>
      </div>
      {saved && <p className="text-emerald-600 text-sm mb-3">הדרישות נשמרו ✓</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <CoverageTable
          title="ראשון–חמישי"
          rows={rows}
          dayType="weekday"
          onUpdate={update}
          onRemove={removeRow}
          onAdd={() => addRow("weekday")}
        />
        <CoverageTable
          title="שישי"
          rows={rows}
          dayType="friday"
          onUpdate={update}
          onRemove={removeRow}
          onAdd={() => addRow("friday")}
        />
      </div>
    </div>
  );
}

function CoverageTable({
  title,
  rows,
  dayType,
  onUpdate,
  onRemove,
  onAdd,
}: {
  title: string;
  rows: Row[];
  dayType: Row["day_type"];
  onUpdate: (idx: number, patch: Partial<Row>) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-bold mb-3">{title}</h3>
      <table className="w-full text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="text-right font-medium pb-2">משעה</th>
            <th className="text-right font-medium pb-2">עד שעה</th>
            <th className="text-right font-medium pb-2">נשות צוות</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) =>
            r.day_type !== dayType ? null : (
              <tr key={idx}>
                <td className="py-1 pl-2">
                  <input
                    type="time"
                    className="border border-slate-300 rounded px-2 py-1"
                    value={r.start_time}
                    onChange={(e) => onUpdate(idx, { start_time: e.target.value })}
                  />
                </td>
                <td className="py-1 pl-2">
                  <input
                    type="time"
                    className="border border-slate-300 rounded px-2 py-1"
                    value={r.end_time}
                    onChange={(e) => onUpdate(idx, { end_time: e.target.value })}
                  />
                </td>
                <td className="py-1 pl-2">
                  <input
                    type="number"
                    min={0}
                    className="border border-slate-300 rounded px-2 py-1 w-20"
                    value={r.required_count}
                    onChange={(e) => onUpdate(idx, { required_count: Number(e.target.value) })}
                  />
                </td>
                <td className="py-1 text-left">
                  <button onClick={() => onRemove(idx)} className="text-red-600 hover:underline">
                    הסרה
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
      <button onClick={onAdd} className="mt-3 text-emerald-700 text-sm hover:underline">
        + הוספת פרוסה
      </button>
    </div>
  );
}
