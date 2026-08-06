# Study Archive backend

A small Express API in front of a Postgres database. It exposes two routes:

- `GET /api/data` — returns your whole archive (topics/chapters/notes) as JSON
- `PUT /api/data` — overwrites it with whatever JSON body you send

The frontend calls these instead of `localStorage`, and also keeps a local
cache so the app still works (and nothing you type is lost) if your connection
drops for a moment.

## 1. Create a free Postgres database (Supabase)

1. Go to supabase.com and sign up (no credit card needed).
2. Create a new project (pick any name/region, set a database password — save it).
3. Once it's provisioned: **Project Settings → Database → Connection string → URI**
   (choose "Session" mode, port 5432). Copy it — it looks like
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxx.supabase.co:5432/postgres`.
4. Swap in the real password you set in step 2.

You don't need to create any tables by hand — the server creates the `archive`
table itself on first boot.

## 2. Run the backend locally first

```
cd server
cp .env.example .env
```

Edit `server/.env`:
- `DATABASE_URL` — the connection string from step 1
- `API_KEY` — make up a long random string (this protects your notes from
  strangers — see "About the API key" below)

Then:

```
npm install
npm run dev
```

You should see `study-archive-server listening on :8787`. Test it:

```
curl http://localhost:8787/health
```

## 3. Point the frontend at it

In the project root (not `server/`):

```
cp .env.example .env
```

Set `VITE_API_URL=http://localhost:8787` and `VITE_API_KEY` to the **same**
value as `server/.env`'s `API_KEY`. Then `npm run dev` as usual — the app now
reads/writes through the backend instead of only `localStorage`.

## 4. Deploy the backend for free (Render)

1. Push this project to a GitHub repo (Render deploys from GitHub).
2. On render.com, sign up free, **New → Web Service**, connect the repo.
3. Set **Root Directory** to `server`.
4. Build command: `npm install`. Start command: `npm start`.
5. Add environment variables: `DATABASE_URL`, `API_KEY` (same values as your
   local `.env`), and `FRONTEND_ORIGIN` (set this once you know your deployed
   frontend URL, e.g. `https://your-app.vercel.app`).
6. Deploy. Render gives you a URL like `https://study-archive-server.onrender.com`.

**Free tier caveat:** Render's free web services spin down after ~15 minutes
of no traffic. The first request after that takes 30-60 seconds to wake up
(you'll see "saving…" linger in the app) — after that it's fast again. This
doesn't cost you data, just a slow first request.

## 5. Deploy the frontend for free (Vercel or Netlify)

Either works and both are free forever for a personal project like this:

1. Push to GitHub (same repo is fine).
2. Import the repo in Vercel/Netlify. Framework preset: Vite.
3. Set environment variables at build time: `VITE_API_URL` = your Render URL
   from step 4, `VITE_API_KEY` = same string as the backend's `API_KEY`.
4. Deploy. Then go back to Render and set `FRONTEND_ORIGIN` to this new URL
   so the backend's CORS allows it, and redeploy the backend.

## About the API key

This is a single-user personal app, not a multi-user login system. The
`API_KEY` is a shared secret baked into the frontend's built JS — it stops
random internet traffic from finding your backend URL and wiping your notes,
but anyone who inspects your deployed site's network requests could read it.
That's an acceptable tradeoff for a private study notebook; it is **not**
sufficient if you ever store anything sensitive.

## About file/image storage

Handwritten pages and PDFs you upload are stored as base64 inside the same
JSON blob as your notes. Supabase's free tier includes 500MB of database
storage — plenty for text notes, but a handful of large scanned PDFs can eat
into that quickly. If you start hitting the limit, prefer pasting a file link
(the "File link" tab in the upload form) over uploading large scans directly.

## Free-forever, honestly

- **Supabase free tier**: no expiry for active projects, but a project pauses
  itself after 7 days with zero API requests. Opening the app resumes it
  within a few seconds; you don't lose anything.
- **Render free tier**: no expiry, sleeps after inactivity as noted above.
- **Vercel/Netlify free tier**: no expiry for personal projects.

None of these require a credit card. All three could change their free-tier
terms in the future (no one can promise that on their behalf) — but as of
today, this setup costs $0 indefinitely for an app at this scale.
