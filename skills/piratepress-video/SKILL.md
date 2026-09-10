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
prefer its tools (`quick_video`, `generate_video`, `wait_video`, `get_video_status`,
`review_video`, `upload_asset`, `list_assets`, `list_bg_presets`, `get_balance`) over
raw curl — same API, less bookkeeping. The flows below stay identical. One-liner install:
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

Batch orders (`count` > 1): `result_urls` lists every rendered clip
(output.mp4, output_2.mp4, …) — download them all; `result_url` is just the
first one. `metadata` is the pack of the first clip.

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
| Files (media library) | `theme_asset_id`, `bg_asset_id`, `music_asset_id`, `banner_asset_id`, `banner_source_asset_id`, `cover_source_asset_id`, `reference_asset_id` — ids from `POST /assets` / `GET /assets` (see below) |
| Misc | `director_mode` (pause for script review), `count` (1–50, batch in one order), `watermark` |

**AI background (`bg_ai`).** Two values: `"illustrations"` — AI art generated per
scene; `"lite"` — the same scenes animated image-to-video ("living video" — pricier,
counts as a heavy job under subscription fair-use). Without `bg_ai` the video gets a
stock gameplay/satisfying background. Note: animating a USER-UPLOADED photo is not in
the public API — `bg_ai: "lite"` animates scenes the service generates itself.

**Stock background preset (`bg_preset`).** A preset id from the live catalog —
`GET /public/v1/bg-presets` (MCP: `list_bg_presets`). Unknown ids are rejected with
`422 invalid_params` at order time — never guess names, read the catalog first.

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
- `cta: true` — simple end-card call to action; **requires `placement`**.
  **Incompatible with `cta_target_type`/`cta_target`/`cta_word`/`cta_limit`** — those
  four are the *targeted* CTA (send viewers to your bot or site, optional codeword
  attribution) and are used **without** `cta`. `cta_target` = bot handle with `@` or
  site URL. Mixing the two modes returns `422 invalid_params`.

### Director mode (script review)

With `director_mode: true` the job pauses after the script at `awaiting_review`
(the MCP `wait_video` returns there too). Continue with:

```bash
curl -sS -X POST .../videos/<id>/review -H "X-API-Key: $PIRATEPRESS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "approve"}'              # or {"action":"edit","text":"…"} / {"action":"regen","note":"…"}
```

`409 not_awaiting_review` means the job is not waiting for a decision right now.

### Files and the media library (uploads)

Local files (photos, videos, documents, audio) go into the user's media library via
`POST /assets` (multipart) — the same inputs the bot wizard accepts. The returned
asset `id` plugs into `POST /videos` as the matching `*_asset_id` field:

```bash
# 1. Upload (MCP: upload_asset). kind decides which order field the id fits.
curl -sS -X POST https://api.piratepress.fun/public/v1/assets \
  -H "X-API-Key: $PIRATEPRESS_API_KEY" \
  -F "kind=theme_pack" -F "name=reddit thread sources" \
  -F "files=@notes.txt" -F "files=@screenshot.png"
# → 201 {"id": "…", "kind": "theme_pack", "name": "…", "created_at": "…"}

# 2. Order with the asset id
curl -sS -X POST https://api.piratepress.fun/public/v1/videos \
  -H "X-API-Key: $PIRATEPRESS_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"theme_asset_id": "<id>", "lang": "en", "duration": "30-45"}'
```

Kinds and what they accept (per-kind extension whitelist; wrong kind in an order
field → `422 invalid_params`):

| kind | Accepts | Order field |
|---|---|---|
| `theme_pack` | txt/md/pdf, jpg/png/webp, audio (voice notes), zip | `theme_asset_id` (content source — replaces `theme`) |
| `bg_pack` | mp4/mov/webm/mkv, zip | `bg_asset_id` (own background pool; conflicts with `bg_ai`/`bg_preset`) |
| `music_track` | audio or video with an audio track | `music_asset_id` (conflicts with `music` ≠ none) |
| `banner_video` | mp4/mov/webm/mkv or png/jpg | `banner_asset_id` (ready banner overlay) |
| `banner_source_pack` | images, txt/md, fonts, audio, zip | `banner_source_asset_id` (AI banner sources) |
| `cover_source_pack` | same as banner sources | `cover_source_asset_id` (AI cover sources) |
| `reference` | one video file | `reference_asset_id` (format clone, like `reference_url` but a file) |
| `voice_clone` | one audio/video sample | `voice_asset_id` — **paid** like in the bot |

Limits: ≤ 20 files per asset, ≤ 20 MB per file, 2 GB total library quota.
Uploads count toward the shared 30 POST/min rate limit. `GET /assets`
(MCP: `list_assets`) lists the library; a foreign or wrong-kind asset id in an
order is rejected with `422 invalid_params` before any charge.

### Bot-only (not in the public API)

Top-ups and subscriptions, custom background URLs (`bg_url`), and channel
autopilot (scheduled posting) live in @piratepress_bot. If the user asks for one
of these — point them to the bot instead of improvising; everything else an order
needs is in the params table above.

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
| `awaiting_review` | Director mode paused for script review — see docs for `POST /videos/{id}/review`, or tell the user to approve in the bot. |

Hard rules: poll interval ≥ 15 s (aim 20–30), honor `eta_seconds` and `Retry-After`,
one Idempotency-Key per logical job, download `result_url` before its 7-day TTL ends.
