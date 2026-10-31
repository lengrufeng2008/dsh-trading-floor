# Review guide

A 60-second path through the code, with the claims and limits in one place.

## What to read

1. `package.json` — `dsh.bundle.patch` + `dsh.client`; no runtime dependencies, no install scripts.
2. `cordis.patch.yml` — one row, `id: trading-floor`, name `dsh-trading-floor`.
3. `index.js` — intentionally empty Host half; this release has no Host route or service.
4. `client.js` — the whole plugin:
   - `buildSnapshot()` folds the existing `session/list` projections into the active book;
   - `rpcSessionList()` calls the same-origin Web RPC;
   - `TradingFloor` renders the ticker, six lenses, chart, gauges, web, gate, and log;
   - `FULL DESK` is a body portal; `Esc` is isolated with a capture listener.
5. `test/snapshot.test.mjs` — pure fold tests; no browser required.
6. `docs/full-desk.gif` — live demo; `docs/*.png` — static frames.

## Data flow

```
DSH Web UI session projections
        │  same-origin POST /api/session/list
        ▼
rpcSessionList() → buildSnapshot() → React components
        │
        └─ no writes, no external hosts, no market feed, no orders
```

The plugin reads the same remote API the Web UI's own session list uses. It does not read files
from the Host, open a socket, or register a route.

## Security / privacy

- Read-only: the only writes are local UI state (`FULL DESK`, `COPY`, `REFRESH`).
- No credentials, API keys, cookies, or prompts are sent anywhere.
- Logs show session titles, step counts, context size, and subagent labels; no prompt/response text.
- `navigator.clipboard` is used only for the explicit `COPY` action.
- All session titles and paths stay in the local Web origin.

## Accuracy

- Active book = sessions whose last prompt is today, or running.
- Spend = **lifetime** token usage of those sessions at DeepSeek **idle** rates.
- It is **not** an exact daily bill; call timestamps are not in the projection. Exact daily
  accounting belongs to `dsh-token-audit`.
- Book cap (default ¥100), context cap (70%), and cache target (50%) are policy gates, not provider
  facts.
- Unknown models fall back to flash pricing; the UI labels the result as an estimate.

## Verification

- `npm test` — 4/4.
- Live Web profile (0.2.1-rc.2): Settings → Trading Floor; 0 page/console errors; 1600×1000 and
  1920×1080 screenshots; FULL DESK/Esc/Copy/Refresh tested.
- Clean temp profile: `dsh plugin --profile web add dsh-trading-floor-0.2.0.tgz` followed by
  `dsh --profile web --dump-config` composed the `trading-floor` row; the Plugins page listed
  **Trading Floor** with the locale description.

## Known limits

- The `session/list` response includes every visible session; on a very large corpus the browser
  pays the list cost every 10 s.
- The Host projection exposes lifetime usage only; exact daily cost needs a Host `wire.view` or
  event timestamps (P3).
- No approval actions are wired; the gate reports policy/goal/question state.
