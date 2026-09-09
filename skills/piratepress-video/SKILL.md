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
prefer its tools (`generate_video`, `quick_video`, `wait_video`, `get_video_status`,
`review_video`, `list_assets`, `list_bg_presets`, `get_balance`) over raw curl — same API, less
bookkeeping. The flows below stay identical. One-liner install:
`curl -fsSL https://piratepress.fun/install.sh | bash`.

## 0. Get the API key

You need `PIRATEPRESS_API_KEY`. If it is not in the environment, ask the user:

> Пришлите API-ключ PiratePress: в Telegram-боте **@piratepress_bot** выполните команду
> `/apikey` — ключ вида `pp_…` показывается один раз.

Never invent a key, never store it in the repo. Use it as the `X-API-Key` header.

Base URL: `https://api.piratepress.fun/public/v1`

## 1. The core loop (curl)

Generation takes **minutes** (usually 2–15). Never block in a tight loop.

**Prefer explicit params (`POST /videos`) over the quick endpoint.** You are an
agent — mapping the user's brief to parameters is exactly your job; the quick
endpoint re-does that mapping with a server-side LLM, which can drift off-topic,
hides the cost until after creation, and is throttled to a few calls per hour.
Use quick only for genuinely vague one-liners.

```bash
# 1. Create the job — explicit params. Idempotency-Key protects against
#    double-charging on retries.
curl -sS -X POST https://api.piratepress.fun/public/v1/videos \
  -H "X-API-Key: $PIRATEPRESS_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"theme": "Why houseplants die in winter", "lang": "en", "duration": "30-45",
       "placement": "PlantCare app", "hook": true, "cta": true}'
# → 201 {"id": "…", "status": "queued", "cost": 100, "eta_seconds": 420}

# 2. Poll — every 20–30 s, NEVER more often than 15 s. Respect eta_seconds:
#    first poll no earlier than ~half the ETA.
curl -sS https://api.piratepress.fun/public/v1/videos/<id> \
  -H "X-API-Key: $PIRATEPRESS_API_KEY"
# status: queued | running | awaiting_review | done | error | refunded

# 3. On done — download immediately; result_url is signed and dies in 7 days.
#    Use the result_url VERBATIM from the fresh JSON response — it is an
#    absolute URL; never rebuild, trim or reassemble it from parts, and never
#    reuse a copy from truncated log output (a cut-off token → 401 invalid_token).
#    result_url needs NO API key: if downloading through your sandbox is slow
#    or blocked, hand the link to the user directly instead of proxying the
#    file through yourself.
curl -fsSL -o video.mp4 "<result_url>"   # wget -O video.mp4 "<result_url>" works too
```

`metadata` in the final object is the posting pack (title/description/hashtags) —
hand it to the user together with the file.

The quick endpoint (`POST /videos:quick`, MCP: `quick_video`) — one free-form
prompt the server maps to params for you. Only for vague one-liners:

```bash
curl -sS -X POST https://api.piratepress.fun/public/v1/videos:quick \
  -H "X-API-Key: $PIRATEPRESS_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"prompt": "45s EN vertical about why houseplants die in winter, calm tone"}'
```

Key params: `theme` (full sentence — one-word input yields garbage), `lang` (ru|en),
`duration` ("30" or "15-45"), `placement` (product woven natively into the story —
CTA requires placement), `hook`, `cta`.

Full `POST /videos` surface (everything is optional except a content source —
`theme`, `theme_url` or `reference_url`):

| Group | Params |
|---|---|
| Content | `theme`, `theme_url`, `lang` (ru\|en), `duration`, `style` (delivery), `genre` |
| Advertising | `placement`, `hook`, `end_card`, `cta`, `cta_target_type` (bot\|site), `cta_target`, `cta_word`, `cta_limit` |
| Background & visual | `bg_ai`, `bg_preset`, `bg_fit` (fill\|fit), `overlays`, `overlay_count` (1–5), `overlay_level` (1–3), `visual_style` |
| Captions | `caption_mode` (word\|karaoke\|line), `caption_position` (top\|center\|bottom), `caption_scale` (0.01–0.2) |
| Music & voice | `music` (none\|ai\|song — "song" sings the story as a track), `music_mood`, `voice_asset_id` (voice clone from the library — see below) |
| Misc | `director_mode` (pause for script review), `count` (1–50, batch in one order), `watermark` |

**AI background (`bg_ai`).** Two values: `"illustrations"` — AI art generated per
scene; `"lite"` — the same scenes animated image-to-video ("living video" — pricier,
counts as a heavy job under subscription fair-use). Without `bg_ai` the video gets a
stock gameplay/satisfying background. Note: animating a USER-UPLOADED photo is not in
the public API — `bg_ai: "lite"` animates scenes the service generates itself.

**Background presets (`bg_preset`).** Ids come from the live catalog —
`GET /bg-presets` (MCP: `list_bg_presets`) returns `[{name, videos}]`. Never invent
an id (unknown ones fail validation or silently fall back); omit `bg_preset` for a
random stock background.

**Links as input.** The server does not "watch" arbitrary URLs inside a free-form
prompt — route them explicitly (quick_video does this mapping for you, but explicit
is more reliable):
- Article/post/page the story is based on → `theme_url: ["https://…"]`
  (the service fetches and reads the text). Conflicts with `theme` — use one or the other.
- YouTube/TikTok/Instagram video to base the clip on → `reference_url: "https://…"`
  (downloaded, speech transcribed, format/pacing/voice cloned; add `theme` only if the
  user wants a different topic than the reference's own).

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

### Director mode (script review)

With `director_mode: true` the job pauses after the script at `awaiting_review`
(the MCP `wait_video` returns there too). The status response then carries the
script itself in `story_text` — **read it and show it to the user before
deciding**; never approve blind. Continue with:

```bash
curl -sS -X POST .../videos/<id>/review -H "X-API-Key: $PIRATEPRESS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "approve"}'              # or {"action":"edit","text":"…"} / {"action":"regen","note":"…"}
```

`409 not_awaiting_review` means the job is not waiting for a decision right now.

### Voice clones and the media library

`voice_asset_id` takes an asset id from the user's library — list it via
`GET /assets` (MCP: `list_assets`). Uploading new assets (voice clone from a
10-second sample, banners) happens **in the bot only** — the public API has no
upload endpoint.

### Bot-only (not in the public API)

Top-ups and subscriptions, asset uploads, banner overlay / AI banner / AI cover,
custom background URLs, and channel autopilot (scheduled posting) live in
@piratepress_bot. If the user asks for one of these — point them to the bot
instead of improvising; everything else an order needs is in the params table above.

## 4. Errors and what to do

Errors come as `{"error": {"code", "message"}}`.

| Situation | Action |
|---|---|
| `402 insufficient_funds` | Tell the user the cost and ask them to top up in @piratepress_bot (1⛁ = 1₽). Do not retry until they confirm. |
| `429 rate_limited` | Read the `Retry-After` header and wait exactly that long. Limits: 10 active jobs, 30 POST/min. Never hammer. |
| `409 fair_use_exceeded` | Heavy-video quota on the subscription is exhausted for the month — offer a lighter config (no `bg_ai`, shorter duration) or dublone payment. |
| `422 invalid_params` | Fix the body per `message` (e.g. `cta` without `placement`) and resubmit with a **new** Idempotency-Key. |
| `401` | Key missing/revoked — ask the user for a fresh one (`/apikey`). |
| Job `status: "error"` | Report the `error` field. The job failed with no doubloon charge (trial or externally paid). Do not auto-retry paid generations without asking. |
| Job `status: "refunded"` | The job failed and the charge was **auto-refunded** — the `error` field says so, and `GET /balance` confirms it. Tell the user no doubloons were lost; never report it as money gone, and ask before resubmitting. |
| `awaiting_review` | Director mode paused for script review — the same response includes `story_text`; show it to the user, then answer via `POST /videos/{id}/review` (MCP: `review_video`). |

Hard rules: poll interval ≥ 15 s (aim 20–30), honor `eta_seconds` and `Retry-After`,
one Idempotency-Key per logical job, download `result_url` before its 7-day TTL ends.
