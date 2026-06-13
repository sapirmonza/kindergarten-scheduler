import { useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import StaffPage from "./pages/StaffPage";
import CoveragePage from "./pages/CoveragePage";
import WeekPage from "./pages/WeekPage";
import ReportsPage from "./pages/ReportsPage";
import LoginPage from "./pages/LoginPage";
import { auth } from "./api";

const navItems = [
  { to: "/staff", label: "ניהול צוות" },
  { to: "/coverage", label: "דרישות כיסוי" },
  { to: "/week", label: "שיבוץ שבועי" },
  { to: "/reports", label: "דוחות" },
];

export default function App() {
  const [loggedIn, setLoggedIn] = useState(auth.isLoggedIn());
  if (!loggedIn) return <LoginPage onLogin={() => setLoggedIn(true)} />;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-base sm:text-xl font-bold text-emerald-700 flex items-center gap-2">
            <span>🧸</span> <span className="whitespace-nowrap">ניהול משמרות - גן ילדים</span>
          </h1>
          <nav className="flex flex-wrap gap-1 order-last w-full sm:order-none sm:w-auto">
            {navItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `px-2.5 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    isActive ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <button onClick={() => auth.logout()} className="text-sm text-slate-500 hover:text-slate-700 ms-auto">
            יציאה
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/staff" replace />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/coverage" element={<CoveragePage />} />
          <Route path="/week" element={<WeekPage />} />
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>
      </main>
    </div>
  );
}
