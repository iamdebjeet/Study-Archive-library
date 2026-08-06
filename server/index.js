import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;
const PORT = process.env.PORT || 8787;
const API_KEY = process.env.API_KEY || "";
const DATABASE_URL = process.env.DATABASE_URL;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var. Set it to your Supabase Postgres connection string (see server/.env.example).");
  process.exit(1);
}

if (!API_KEY) {
  console.warn(
    "WARNING: API_KEY is not set. The /api/data endpoint is UNPROTECTED and anyone with the URL could read or overwrite your notes. Set API_KEY before deploying publicly."
  );
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function ensureSchema() {
  await pool.query(`
    create table if not exists archive (
      id int primary key default 1,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      constraint archive_single_row check (id = 1)
    )
  `);
}

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(
  cors({
    origin: FRONTEND_ORIGIN ? FRONTEND_ORIGIN.split(",").map((s) => s.trim()) : "*",
  })
);

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const key = req.header("x-api-key");
  if (key !== API_KEY) return res.status(401).json({ error: "invalid or missing api key" });
  next();
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/api/data", requireApiKey, async (req, res) => {
  try {
    const result = await pool.query("select data from archive where id = 1");
    if (result.rows.length === 0) return res.status(404).json({ error: "not found" });
    res.json(result.rows[0].data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "database error" });
  }
});

app.put("/api/data", requireApiKey, async (req, res) => {
  const data = req.body;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return res.status(400).json({ error: "body must be a JSON object" });
  }
  try {
    await pool.query(
      `insert into archive (id, data, updated_at) values (1, $1, now())
       on conflict (id) do update set data = excluded.data, updated_at = now()`,
      [data]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "database error" });
  }
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`study-archive-server listening on :${PORT}`));
  })
  .catch((e) => {
    console.error("Failed to initialize database schema:", e);
    process.exit(1);
  });
