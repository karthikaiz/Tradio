# Migrating the Tradio backend from Vercel to Fly.io

Why: Vercel's free tier bills per serverless invocation and paused the
deployment (402) when AlgoBot's price polling exhausted the compute quota.
On Fly, the backend is one always-available container — no per-request
billing, so polling is free.

Target setup (hard cost cap):

- ONE `shared-cpu-1x` machine, 256MB RAM — ~$1.94/mo worst case, less with
  auto-stop (machine sleeps when idle; stopped machines cost ~nothing)
- 512MB swap (free — it's disk, not billed RAM) absorbs memory spikes
- `--ha=false` in the deploy workflow prevents Fly's default second machine
- No volumes, no Fly Postgres (DB stays on Supabase)
- Frontend STAYS on Vercel free tier — only the backend moves

## One-time setup

1. **GitHub secret** — repo Settings → Secrets → Actions → add
   `FLY_API_TOKEN` (get it from https://fly.io/user/personal_access_tokens
   or `flyctl auth token`).

2. **Merge to main** — the `deploy-backend.yml` workflow creates the app
   and deploys it. (App name `tradio-backend` must be globally unique; if
   creation fails, change `app` in `backend/fly.toml`.)

3. **Fly secrets** (backend env vars) — run once, from any machine with
   flyctl, or the Fly.io web dashboard (app → Secrets):

   ```
   flyctl secrets set -a tradio-backend \
     DATABASE_URL="<supabase postgres url>" \
     SUPABASE_ANON_KEY="<anon key>" \
     GROQ_API_KEY="<groq key>" \
     FRONTEND_URL="https://tradio-seven.vercel.app"
   ```

4. **Verify**: `https://tradio-backend.fly.dev/health` → `{"status":"ok"}`

## Cutover (after /health works)

5. **Vercel** → project → Settings → Environment Variables →
   set `NEXT_PUBLIC_API_URL=https://tradio-backend.fly.dev` → redeploy
   frontend. The Next.js rewrite now proxies `/api/*` to Fly.

6. **AlgoBot** → point it at Fly and restart:

   ```
   flyctl secrets set -a algobot TRADIO_BASE_URL="https://tradio-backend.fly.dev"
   ```

7. **Cleanup** (optional, after everything works): remove the `backend`
   service block from the root `vercel.json` so Vercel stops building the
   Python functions entirely.

## Billing guardrails already in the config

| Risk | Guard |
|---|---|
| Fly creating 2 machines (default HA) | `--ha=false` in deploy workflow |
| Bigger machine sneaking in | `[[vm]] memory = "256mb"` in fly.toml — Fly never auto-resizes |
| Paying while idle | `auto_stop_machines = "stop"`, `min_machines_running = 0` |
| OOM crashes on 256MB | `swap_size_mb = 512` (free, disk-backed) |
