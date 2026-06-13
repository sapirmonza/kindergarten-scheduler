import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { ensureTables } from "./db";
import staffRouter from "./routes/staff";
import coverageRouter from "./routes/coverage";
import weeksRouter from "./routes/weeks";
import reportsRouter from "./routes/reports";

const PORT = Number(process.env.PORT) || 3100;

ensureTables();

// --- simple shared-credential auth ---
const AUTH_USER = process.env.ADMIN_USER || "מאמוש";
const AUTH_PASS = process.env.ADMIN_PASS || "מאמוש2013";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "mamoosh-kg-token-2013"; // shared bearer token

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === AUTH_USER && password === AUTH_PASS) return res.json({ token: AUTH_TOKEN });
  res.status(401).json({ error: "שם משתמש או סיסמה שגויים" });
});

// gate every other /api route behind the bearer token
app.use("/api", (req, res, next) => {
  if (req.path === "/login" || req.path === "/health") return next();
  if (req.headers.authorization === `Bearer ${AUTH_TOKEN}`) return next();
  res.status(401).json({ error: "unauthorized" });
});

app.use("/api/staff", staffRouter);
app.use("/api/coverage", coverageRouter);
app.use("/api/weeks", weeksRouter);
app.use("/api/reports", reportsRouter);

// In production, serve the built React app from ../public
const publicDir = path.join(__dirname, "..", "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
}

app.listen(PORT, () => console.log(`Kindergarten scheduler API listening on :${PORT}`));
