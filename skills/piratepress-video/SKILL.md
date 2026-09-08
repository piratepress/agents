---
name: piratepress-video
description: 'Generate viral short-form videos through the PiratePress public API — single clips from a one-line brief, explicit-param jobs (placement/hook/cta), and batch scenarios ("5 videos on these topics", daily digest). Load when the user asks to create/generate a video via PiratePress, batch-generate content, or automate a posting pipeline. Docs: https://docs.piratepress.fun'
---

# PiratePress Video Generation

PiratePress turns a text brief into a finished viral short video (voiceover, captions,
music, posting metadata) via a REST API. This skill is the agent playbook; the full
parameter reference lives at **https://docs.piratepress.fun** (OpenAPI:
`https://api.piratepress.fun/docs`) — check there before using a parameter not shown here.

**MCP alternative:** if the `piratepress` MCP server is installed in this environment,
prefer its tools (`quick_video`, `generate_video`, `wait_video`, `get_balance`) over raw
curl — same API, less bookkeeping. The flows below stay identical. One-liner install:
`curl -fsSL https://piratepress.fun/install.sh | bash`.

## 0. Get the API key

You need `PIRATEPRESS_API_KEY`. If it is not in the environment, ask the user:

> Пришлите API-ключ PiratePress: в Telegram-боте **@piratepress_bot** выполните команду
> `/apikey` — ключ вида `pp_…` показывается один раз.

Never invent a key, never store it in the repo. Use it as the `X-API-Key` header.

Base URL: `https://api.piratepress.fun/public/v1`

## 1. The core loop (curl)

Generation takes **minutes** (usually 2–15). Never block in a tight loop.

```bash
# 1. Create the job — free-form prompt, server-side LLM maps it to params.
#    Idempotency-Key protects against double-charging on retries.
curl -sS -X POST https://api.piratepress.fun/public/v1/videos:quick \
  -H "X-API-Key: $PIRATEPRESS_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"prompt": "45s EN vertical about why houseplants die in winter, calm tone"}'
# → 201 {"id": "…", "status": "queued", "cost": 100, "eta_seconds": 420}

# 2. Poll — every 20–30 s, NEVER more often than 15 s. Respect eta_seconds:
#    first poll no earlier than ~half the ETA.
curl -sS https://api.piratepress.fun/public/v1/videos/<id> \
  -H "X-API-Key: $PIRATEPRESS_API_KEY"
# status: queued | running | awaiting_review | done | error

# 3. On done — download immediately; result_url is signed and dies in 7 days.
#    Use the result_url VERBATIM from the fresh JSON response — it is an
#    absolute URL; never rebuild, trim or reassemble it from parts, and never
#    reuse a copy from truncated log output (a cut-off token → 401 invalid_token).
curl -fsSL -o video.mp4 "<result_url>"   # wget -O video.mp4 "<result_url>" works too
```

`metadata` in the final object is the posting pack (title/description/hashtags) —
hand it to the user together with the file.

Explicit params instead of a prompt → `POST /videos`:

```bash
curl -sS -X POST https://api.piratepress.fun/public/v1/videos \
  -H "X-API-Key: $PIRATEPRESS_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"theme": "Why houseplants die in winter", "lang": "en", "duration": "30-45",
       "placement": "PlantCare app", "hook": true, "cta": true}'
```

Key params: `theme` (full sentence — one-word input yields garbage), `lang` (ru|en),
`duration` ("30" or "15-45"), `placement` (product woven natively into the story —
CTA requires placement), `hook`, `cta`. Also `music`, `bg_ai`, `reference_url`
(format clone from a YouTube/TikTok link) and more — see the docs.

## 2. Money — check before you spend

- Currency is **dublones: 1⛁ = 1₽**. Charged at job **creation**, not completion.
- Top-up is only in the bot (@piratepress_bot) — you cannot add funds via the API.
- **Before any batch**, read the balance and quote the user the projected cost:

```bash
curl -sS https://api.piratepress.fun/public/v1/balance -H "X-API-Key: $PIRATEPRESS_API_KEY"
# → {"dublones": 530, "subscription": "creator", "fair_use_left": null}
```

If `cost × count` approaches the balance, warn the user and confirm before spending.

## 3. Scenarios

### Batch: "make 5 videos on these topics"

1. `GET /balance` → report projected spend, get an implicit/explicit go-ahead.
2. Create jobs with **one stable Idempotency-Key per topic** (e.g. a UUID derived once
   per topic and reused on retry — a retry then returns the original job without
   double-charging).
3. Respect the **10 active jobs** limit: submit in waves; if you hit it, poll
   `GET /videos/{id}` until some finish, then submit the rest.
4. Poll all jobs in round-robin every 20–30 s (one GET per job per round, not a loop
   per job). Download each `result_url` as it reaches `done`; collect failures with
   their `error` field and report at the end — do not silently retry paid jobs.

### Daily digest (cron + quick)

Schedule a recurring job (cron / scheduled task) that runs:

```bash
curl -sS -X POST .../videos:quick -H "Idempotency-Key: digest-$(date +%F)" ...
```

The date-stamped idempotency key makes re-runs within a day safe. After creation, the
same job polls and saves the mp4 + metadata into the user's content folder.

### placement / hook / cta

- `placement` — the product must appear **in the story**, not as an ad read: give the
  product plus context ("PlantCare app that reminds you to water"), not just a brand name.
- `hook: true` (default) — first-seconds hook; keep it on for feed traffic.
- `cta: true` — end-card call to action; **requires `placement`**, and `cta_target`
  (`bot` | `site` + URL/handle) tells where to send viewers.

## 4. Errors and what to do

Errors come as `{"error": {"code", "message"}}`.

| Situation | Action |
|---|---|
| `402 insufficient_funds` | Tell the user the cost and ask them to top up in @piratepress_bot (1⛁ = 1₽). Do not retry until they confirm. |
| `429 rate_limited` | Read the `Retry-After` header and wait exactly that long. Limits: 10 active jobs, 30 POST/min. Never hammer. |
| `409 fair_use_exceeded` | Heavy-video quota on the subscription is exhausted for the month — offer a lighter config (no `bg_ai`, shorter duration) or dublone payment. |
| `422 invalid_params` | Fix the body per `message` (e.g. `cta` without `placement`) and resubmit with a **new** Idempotency-Key. |
| `401` | Key missing/revoked — ask the user for a fresh one (`/apikey`). |
| Job `status: "error"` | Report the `error` field. Do not auto-retry paid generations without asking. |
| `awaiting_review` | Director mode paused for script review — see docs for `POST /videos/{id}/review`, or tell the user to approve in the bot. |

Hard rules: poll interval ≥ 15 s (aim 20–30), honor `eta_seconds` and `Retry-After`,
one Idempotency-Key per logical job, download `result_url` before its 7-day TTL ends.
