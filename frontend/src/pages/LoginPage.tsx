import { useState } from "react";
import { login } from "../api";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
      onLogin();
    } catch {
      setError("שם משתמש או סיסמה שגויים");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-emerald-700 flex items-center gap-2 mb-1">
          <span>🧸</span> ניהול משמרות - גן ילדים
        </h1>
        <p className="text-sm text-slate-500 mb-6">התחברות</p>

        <label className="block text-sm font-medium mb-1">שם משתמש</label>
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />

        <label className="block text-sm font-medium mb-1">סיסמה</label>
        <input
          type="password"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg"
        >
          {busy ? "מתחבר…" : "כניסה"}
        </button>
      </form>
    </div>
  );
}
