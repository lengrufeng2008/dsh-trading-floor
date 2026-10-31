window.__ModuleLoader__.load({
  id: 'dsh-trading-floor',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const { useState, useEffect, useMemo } = React
    const h = React.createElement
    const createPortal = ReactDOM.createPortal

    const REFRESH_MS = 10000
    const BUDGET_CNY = 100
    const SHANGHAI_OFFSET = 8 * 3600_000
    const HOLIDAYS_2026 = new Set([
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
      '2026-04-06', '2026-05-01', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-09-25',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
    ])
    const PRICES = {
      'deepseek-flash': [0.02, 1, 4],
      'deepseek-v4-flash': [0.02, 1, 4],
      'deepseek-v4-pro': [0.15, 4.5, 13.5],
    }
    const FALLBACK_PRICE = PRICES['deepseek-flash']

    const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
    const pct = (value) => {
      const v = Number(value)
      if (!Number.isFinite(v)) return '0%'
      const p = v * 100
      return `${p >= 10 ? p.toFixed(0) : p.toFixed(1)}%`
    }
    const compact = (value) => {
      const v = num(value)
      if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
      if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
      if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`
      return String(Math.round(v))
    }
    const money = (value) => `¥${num(value).toFixed(2)}`
    const duration = (ms) => {
      const v = num(ms)
      if (v >= 3600000) return `${(v / 3600000).toFixed(1)}h`
      if (v >= 60000) return `${(v / 60000).toFixed(1)}m`
      return `${Math.round(v / 1000)}s`
    }
    const clockOf = (ms) => {
      const d = new Date(ms + SHANGHAI_OFFSET)
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`
    }
    const short = (value, id) => {
      const text = String(value ?? '').replace(/\s+/g, ' ').trim()
      if (text) return text.length > 46 ? `${text.slice(0, 45)}…` : text
      return String(id ?? '').replace(/^session-/, '').slice(0, 8) || 'session'
    }
    const cwdName = (path) => {
      if (!path) return '~'
      const parts = String(path).split(/[\\/]/).filter(Boolean)
      return parts.at(-1) ?? '~'
    }
    const beijingParts = (ms) => {
      const d = new Date(ms + SHANGHAI_OFFSET)
      return { day: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), hour: d.getUTCHours() }
    }
    const dayStart = (ms) => {
      const d = new Date(ms + SHANGHAI_OFFSET)
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - SHANGHAI_OFFSET
    }
    const isPeak = (ms) => {
      const p = beijingParts(ms)
      if (p.weekday === 0 || p.weekday === 6) return false
      if (HOLIDAYS_2026.has(p.day)) return false
      return (p.hour >= 9 && p.hour < 12) || (p.hour >= 14 && p.hour < 18)
    }
    const idleCost = (hit, miss, out, model) => {
      const [hp, mp, op] = PRICES[model] ?? FALLBACK_PRICE
      return (hit * hp + miss * mp + out * op) / 1e6
    }
    const statusFor = (ratio, cap = 1) => (ratio >= 1 ? 'over' : ratio >= cap * 0.8 ? 'near' : 'inside')

    function buildSnapshot(items, now = Date.now()) {
      const from = dayStart(now)
      const all = Array.isArray(items) ? items : []
      const active = all.filter((item) => (num(item?.updatedAt) >= from) || item?.running)
      const live = active.filter((item) => item?.running)
      const views = []

      for (const item of active) {
        const values = item?.projections?.values ?? {}
        const usage = values.tokenUsage ?? {}
        const ctx = values.contextPressure ?? {}
        const stats = values.sessionStats ?? {}
        const model = values.modelSelection?.lastUsed?.model ?? 'deepseek-flash'
        const hit = num(usage.cacheReadTokens)
        const miss = num(usage.uncachedInputTokens)
        const out = num(usage.outputTokens)
        const cost = idleCost(hit, miss, out, model)
        const ctxTokens = num(ctx.pressureTokens)
        const ctxWindow = num(ctx.contextWindow) || 128000
        views.push({
          id: item.sessionId,
          title: short(values.title, item.sessionId),
          cwd: cwdName(item.cwd),
          live: !!item.running,
          updatedAt: num(item.updatedAt),
          hit,
          miss,
          out,
          tokens: hit + miss + out,
          cost,
          steps: num(stats.steps),
          turns: num(stats.turns),
          llmMs: num(stats.llmMs),
          toolMs: num(stats.toolMs),
          ctxTokens,
          ctxWindow,
          ctxShare: ctxTokens / ctxWindow,
          model,
          preset: values.agentPreset ?? 'standard',
          goalPhase: values.goal?.goal?.phase ?? 'none',
          permission: values.permissions?.currentValue ?? 'unknown',
          questions: Array.isArray(values.userQuestions?.active) ? values.userQuestions.active.length : 0,
          subagents: Array.isArray(values.subagentCatalog) ? values.subagentCatalog : [],
        })
      }

      const totals = views.reduce((acc, view) => {
        acc.hit += view.hit
        acc.miss += view.miss
        acc.out += view.out
        acc.cost += view.cost
        acc.steps += view.steps
        acc.turns += view.turns
        acc.llmMs += view.llmMs
        acc.toolMs += view.toolMs
        acc.ctxMax = Math.max(acc.ctxMax, view.ctxTokens)
        acc.ctxWindow = Math.max(acc.ctxWindow, view.ctxWindow)
        return acc
      }, { hit: 0, miss: 0, out: 0, cost: 0, steps: 0, turns: 0, llmMs: 0, toolMs: 0, ctxMax: 0, ctxWindow: 0 })

      totals.tokens = totals.hit + totals.miss + totals.out
      totals.cacheHit = totals.hit + totals.miss ? totals.hit / (totals.hit + totals.miss) : 0
      totals.outputShare = totals.tokens ? totals.out / totals.tokens : 0
      totals.toolShare = totals.llmMs + totals.toolMs ? totals.toolMs / (totals.llmMs + totals.toolMs) : 0
      totals.ctxShare = totals.ctxWindow ? totals.ctxMax / totals.ctxWindow : 0

      const models = new Map()
      const presets = new Map()
      for (const view of views) {
        const m = models.get(view.model) ?? { model: view.model, sessions: 0, cost: 0 }
        m.sessions++
        m.cost += view.cost
        models.set(view.model, m)
        const p = presets.get(view.preset) ?? { preset: view.preset, sessions: 0 }
        p.sessions++
        presets.set(view.preset, p)
      }

      const orderedViews = views.slice().sort((a, b) => (Number(b.live) - Number(a.live)) || (b.updatedAt - a.updatedAt))
      const current = orderedViews.find((view) => view.permission !== 'unknown')
        ?? orderedViews.find((view) => view.goalPhase !== 'none')
        ?? orderedViews[0]
        ?? null
      const logs = []
      for (const view of views) {
        logs.push({
          at: view.updatedAt,
          t: clockOf(view.updatedAt || now),
          text: `${view.title} · ${view.steps} steps · ${compact(view.hit + view.miss)} ctx`,
          tone: view.live ? 'live' : 'idle',
        })
        for (const sub of view.subagents) {
          logs.push({
            at: num(sub.createdAt) || view.updatedAt,
            t: clockOf(num(sub.createdAt) || view.updatedAt || now),
            text: `${String(sub.label ?? 'subagent')} · subagent`,
            tone: 'sub',
          })
        }
      }
      if (current?.questions) {
        logs.push({ at: now, t: clockOf(now), text: `${current.title} · question waiting`, tone: 'warn' })
      }
      logs.sort((a, b) => b.at - a.at)

      const budgetShare = BUDGET_CNY > 0 ? totals.cost / BUDGET_CNY : 0
      const budgetStatus = BUDGET_CNY > 0 ? statusFor(budgetShare, 1) : 'inside'
      const ctxStatus = statusFor(totals.ctxShare, 0.7)
      const cacheStatus = totals.cacheHit >= 0.5 ? 'inside' : totals.cacheHit >= 0.3 ? 'near' : 'over'
      const modelList = [...models.values()].sort((a, b) => b.cost - a.cost)
      const presetList = [...presets.values()].sort((a, b) => b.sessions - a.sessions)
      const topModel = modelList[0]?.model ?? 'none'
      const topPreset = presetList[0]?.preset ?? 'none'

      const roles = [
        {
          key: 'TAPE', label: 'Active sessions', metric: String(views.length), unit: 'ACTIVE',
          sub: `${live.length} live · ${all.length} seen`, color: '#22d3ee',
        },
        {
          key: 'QUANT', label: 'Agent steps', metric: String(totals.steps), unit: 'STEPS',
          sub: `${totals.turns} turns`, color: '#a78bfa',
        },
        {
          key: 'MACRO', label: 'Agent presets', metric: String(presetList.length), unit: 'PRESETS',
          sub: topPreset, color: '#fbbf24',
        },
        {
          key: 'RISK', label: 'Context max', metric: pct(totals.ctxShare), unit: 'CTX',
          sub: `${compact(totals.ctxMax)} / ${compact(totals.ctxWindow)}`, color: '#f87171',
        },
        {
          key: 'FLOW', label: 'Tool time', metric: pct(totals.toolShare), unit: 'TOOL',
          sub: `${duration(totals.toolMs)} · ${topModel}`, color: '#34d399',
        },
        {
          key: 'PM', label: 'Book spend', metric: money(totals.cost), unit: 'EST',
          sub: `book cap ${pct(budgetShare)}`, color: '#60a5fa',
        },
      ]

      const ticker = [
        { s: 'ACTIVE', v: String(views.length), sub: `${live.length} live`, tone: live.length ? 'ok' : 'muted' },
        { s: 'LIVE', v: String(live.length), sub: 'agents', tone: live.length ? 'ok' : 'muted' },
        { s: 'STEPS', v: String(totals.steps), sub: 'book', tone: 'muted' },
        { s: 'TOKENS', v: compact(totals.tokens), sub: `${compact(totals.hit)} cache`, tone: 'muted' },
        { s: 'CACHE', v: pct(totals.cacheHit), sub: 'hit rate', tone: totals.cacheHit >= 0.5 ? 'ok' : 'warn' },
        { s: 'OUTPUT', v: pct(totals.outputShare), sub: 'token share', tone: 'muted' },
        { s: 'SPEND', v: money(totals.cost), sub: 'book lifetime', tone: budgetStatus === 'over' ? 'bad' : 'ok' },
        { s: 'BUDGET', v: pct(budgetShare), sub: `of ¥${BUDGET_CNY} cap`, tone: budgetStatus === 'over' ? 'bad' : budgetStatus === 'near' ? 'warn' : 'ok' },
      ]

      const checks = [
        {
          key: 'BUDGET', label: 'BOOK CAP', value: `${money(totals.cost)} / ¥${BUDGET_CNY}`,
          detail: `${pct(budgetShare)} used · lifetime cap · idle-rate estimate`, status: budgetStatus,
        },
        {
          key: 'CONTEXT', label: 'CONTEXT', value: `${pct(totals.ctxShare)} / 70%`,
          detail: `${compact(totals.ctxMax)} of ${compact(totals.ctxWindow)}`, status: ctxStatus,
        },
        {
          key: 'CACHE', label: 'CACHE', value: `${pct(totals.cacheHit)} / 50%`,
          detail: 'cache-read input share', status: cacheStatus,
        },
      ]

      const recent = views
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8)
        .map((view) => ({
          title: view.title,
          cwd: view.cwd,
          live: view.live,
          steps: view.steps,
          cost: view.cost,
          model: view.model,
          preset: view.preset,
          questions: view.questions,
          goalPhase: view.goalPhase,
        }))
      const bars = views
        .slice()
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 8)
        .map((view) => ({ title: view.title, cost: view.cost, live: view.live }))

      return {
        version: 2,
        source: 'session/list projections',
        pricing: 'idle',
        generatedAt: now,
        refreshMs: REFRESH_MS,
        window: { from, to: now, label: beijingParts(now).day, tz: 'Asia/Shanghai' },
        scope: 'active-today',
        sample: { items: all.length, active: views.length, live: live.length },
        totals,
        budget: { cny: BUDGET_CNY, spent: totals.cost, share: budgetShare, status: budgetStatus },
        current,
        roles,
        ticker,
        checks,
        logs: logs.slice(0, 10),
        recent,
        bars,
        models: modelList,
        presets: presetList,
      }
    }

    async function rpcSessionList(signal) {
      const rpcId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const response = await fetch('/api/session/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: 'session/list',
          payload: { args: { _request: {} } },
        }),
        signal,
      })
      if (!response.ok) throw new Error(`session/list HTTP ${response.status}`)
      const envelope = await response.json()
      if (envelope?.type !== 'server-response' || envelope?.result?.ok !== true) {
        throw new Error(envelope?.result?.error?.message ?? 'session/list rejected')
      }
      return envelope.result.value?.items ?? []
    }

    function useClock() {
      const [now, setNow] = useState(() => new Date())
      useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000)
        return () => clearInterval(id)
      }, [])
      return clockOf(now.getTime())
    }

    function useTelemetry() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [nonce, setNonce] = useState(0)

      useEffect(() => {
        let alive = true
        let timer = null
        const controller = new AbortController()
        const load = async () => {
          try {
            const items = await rpcSessionList(controller.signal)
            if (alive) {
              setData(buildSnapshot(items))
              setError('')
            }
          } catch (err) {
            if (alive && err?.name !== 'AbortError') setError(String(err?.message ?? err))
          } finally {
            if (alive) timer = setTimeout(load, REFRESH_MS)
          }
        }
        load()
        return () => {
          alive = false
          controller.abort()
          if (timer) clearTimeout(timer)
        }
      }, [nonce])

      return { data, error, reload: () => setNonce((value) => value + 1) }
    }

    const CSS = `
.tf-root{--bg:#060a12;--panel:#0c1422;--panel2:#0f1a2c;--line:#1b2a41;--ink:#dbeafe;--muted:#7f8fa6;--green:#34d399;--red:#f87171;--amber:#fbbf24;--cyan:#22d3ee;container-type:inline-size;background:radial-gradient(1100px 500px at 15% -10%,#0f2a3d 0%,var(--bg) 55%);color:var(--ink);border:1px solid var(--line);border-radius:16px;padding:16px;font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;overflow:hidden}
.tf-root *{box-sizing:border-box}
.tf-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.tf-headright{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tf-brand{display:flex;align-items:center;gap:10px;font-size:13px;letter-spacing:.18em;font-weight:700}
.tf-live{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 0 rgba(52,211,153,.6);animation:tf-pulse 1.8s infinite}
.tf-dim{opacity:.35}
.tf-mock{font-size:10px;letter-spacing:.12em;color:var(--amber);border:1px solid #fbbf2455;background:#fbbf2410;border-radius:999px;padding:2px 8px}
.tf-livebadge{font-size:10px;letter-spacing:.12em;color:var(--green);border:1px solid #34d39955;background:#34d39910;border-radius:999px;padding:2px 8px}
.tf-clock{font-size:11px;color:var(--muted);letter-spacing:.08em}
.tf-ticker{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;border:1px solid var(--line);background:#07101d;border-radius:12px;padding:8px;margin-bottom:12px}
.tf-tick{min-width:0;padding:4px 6px;border-right:1px solid #142134}.tf-tick:last-child{border-right:0}
.tf-sym{font-size:10px;color:var(--muted);letter-spacing:.12em}
.tf-px{font-size:13px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tf-chg{font-size:10px;margin-top:1px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tf-ok{color:var(--green)}.tf-warn{color:var(--amber)}.tf-bad,.tf-over{color:var(--red)}.tf-muted{color:var(--muted)}.tf-near{color:var(--amber)}.tf-inside{color:var(--green)}
.tf-grid{display:grid;grid-template-columns:250px minmax(0,1fr) 290px;gap:12px;align-items:start}
.tf-card{border:1px solid var(--line);background:linear-gradient(180deg,var(--panel2),var(--panel));border-radius:12px;padding:12px;margin-bottom:12px}
.tf-card h3{margin:0 0 10px;font-size:10px;letter-spacing:.16em;color:var(--muted);font-weight:600}
.tf-agent{display:flex;gap:9px;padding:8px 0;border-bottom:1px solid #142134}.tf-agent:last-child{border-bottom:0;padding-bottom:0}
.tf-dot{width:8px;height:8px;border-radius:50%;margin-top:4px;flex:none;background:var(--green)}
.tf-aname{font-size:12px;font-weight:700;letter-spacing:.08em}
.tf-arole{font-size:10px;color:var(--muted);margin-top:1px}
.tf-aright{margin-left:auto;text-align:right;min-width:0}
.tf-apnl{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.tf-astat{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-top:2px}
.tf-atok{font-size:9px;color:#5f7288;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
.tf-chartwrap{position:relative}
.tf-bars{display:flex;flex-direction:column;gap:8px;padding:2px 0 0}
.tf-bar-row{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1.6fr) auto;gap:10px;align-items:center;min-height:21px}
.tf-bar-name{display:flex;align-items:center;gap:7px;font-size:10px;color:#c6d6e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tf-bar-name .tf-dot{margin-top:0;width:6px;height:6px}
.tf-bar-track{height:8px;background:#111e31;border:1px solid #1b2a41;border-radius:999px;overflow:hidden}
.tf-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#0e7490,#22d3ee);min-width:2px}
.tf-bar-cost{font-size:10px;color:#99f6e4;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.tf-bar-empty{font-size:10px;color:var(--muted);padding:8px 0}
.tf-badge{position:absolute;top:6px;right:8px;font-size:9px;color:var(--muted);letter-spacing:.1em}
.tf-gauges{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
.tf-gauge{border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:8px;text-align:center}
.tf-gauge svg{width:74px;height:44px;display:block;margin:0 auto}
.tf-gv{font-size:12px;font-weight:700;margin-top:-4px;font-variant-numeric:tabular-nums}
.tf-gl{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-top:2px}
.tf-web{position:relative}
.tf-web svg{width:100%;height:230px;display:block}
.tf-web .tf-spider{animation:tf-spin 14s linear infinite;transform-origin:260px 118px}
.tf-logs{max-height:230px;overflow:auto;scrollbar-width:thin}
.tf-log{display:flex;gap:8px;font-size:10px;line-height:1.55;color:#b6c6db;padding:3px 0;border-bottom:1px dashed #142134}
.tf-log:last-child{border-bottom:0}
.tf-lt{color:#4d6078;flex:none}
.tf-logline{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tf-logline.tf-tone-live{color:#d1fae5}
.tf-logline.tf-tone-idle{color:#b6c6db}
.tf-logline.tf-tone-sub{color:#c4b5fd}
.tf-logline.tf-tone-warn{color:var(--amber)}
.tf-approval .tf-appr{border:1px solid #24344d;border-radius:10px;padding:9px;margin-bottom:8px;background:#0a1322}
.tf-appr.tf-near{border-color:#fbbf2444;background:#fbbf2408}
.tf-appr.tf-over{border-color:#f8717155;background:#f8717108}
.tf-appr-top{display:flex;justify-content:space-between;font-size:11px;gap:8px}
.tf-appr-top b{letter-spacing:.06em}
.tf-appr-sub{font-size:9px;color:var(--muted);margin-top:3px}
.tf-actions{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.tf-btn{border:1px solid #2b3e5a;background:#111e31;color:#cfe0f5;border-radius:7px;padding:5px 8px;font:inherit;font-size:10px;cursor:pointer;letter-spacing:.06em}
.tf-btn:hover{background:#17283f;border-color:#3b5578}
.tf-btn.ok{border-color:#34d39944;color:#6ee7b7;background:#34d3990d}
.tf-btn.warn{border-color:#fbbf2444;color:#fcd34d;background:#fbbf240d}
.tf-btn.bad{border-color:#f8717144;color:#fca5a5;background:#f871710d}
.tf-foot{display:flex;justify-content:space-between;gap:10px;color:#5f7288;font-size:9px;letter-spacing:.08em;margin-top:4px;flex-wrap:wrap}
.tf-decision{border:1px dashed #2b3e5a;border-radius:8px;padding:7px 9px;font-size:10px;color:#9fb3c8;margin-top:6px;min-height:28px}
.tf-check{font-variant-numeric:tabular-nums;text-align:right}
.tf-banner{border:1px solid #f8717155;background:#f871710d;color:#fca5a5;border-radius:10px;padding:8px 10px;font-size:10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.tf-empty{min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:var(--muted);padding:32px}
.tf-empty h2{margin:0;font-size:14px;letter-spacing:.18em;color:var(--ink);font-weight:700}
.tf-empty p{max-width:440px;margin:0;font-size:11px;line-height:1.6;color:var(--muted)}
.tf-expand{border-color:#22d3ee66;color:#67e8f9;background:#22d3ee12}
.tf-expand:hover{background:#22d3ee1f;border-color:#22d3ee99}
.tf-recent-row{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px dashed #142134}
.tf-recent-row:last-child{border-bottom:0}
.tf-recent-main{min-width:0;flex:1}
.tf-recent-title{font-size:11px;color:#c6d6e9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tf-recent-cost{font-size:11px;color:var(--green);font-variant-numeric:tabular-nums;white-space:nowrap}
@container (max-width:1100px){.tf-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.tf-agents{grid-column:1/-1}.tf-center{grid-column:1}.tf-side{grid-column:2}}
@container (max-width:720px){.tf-ticker{grid-template-columns:repeat(4,minmax(0,1fr))}.tf-grid{grid-template-columns:minmax(0,1fr)}.tf-agents,.tf-center,.tf-side{grid-column:1}.tf-gauges{grid-template-columns:repeat(2,minmax(0,1fr))}.tf-clock{display:none}.tf-headright{gap:0}}
@media (max-width:1100px){.tf-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.tf-agents{grid-column:1/-1}.tf-center{grid-column:1}.tf-side{grid-column:2}}
@media (max-width:720px){.tf-ticker{grid-template-columns:repeat(4,minmax(0,1fr))}.tf-grid{grid-template-columns:minmax(0,1fr)}.tf-agents,.tf-center,.tf-side{grid-column:1}.tf-gauges{grid-template-columns:repeat(2,minmax(0,1fr))}.tf-clock{display:none}.tf-headright{gap:0}}
.tf-root.tf-full{position:fixed;inset:0;z-index:2147483000;border-radius:0;border:0;overflow:auto;padding:18px 22px 22px;background:radial-gradient(1600px 900px at 8% -20%,#123047 0%,#060a12 55%)}
.tf-full .tf-ticker{grid-template-columns:repeat(8,minmax(0,1fr))}
.tf-full .tf-grid{grid-template-columns:250px minmax(0,1fr) 290px}
.tf-full .tf-agents,.tf-full .tf-center,.tf-full .tf-side{grid-column:auto}
.tf-full .tf-web svg{height:310px}
.tf-full .tf-logs{max-height:340px}
@media (prefers-reduced-motion:reduce){.tf-root *{animation:none!important;transition:none!important}}
@keyframes tf-pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}70%{box-shadow:0 0 0 8px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
@keyframes tf-spin{to{transform:rotate(360deg)}}
`

    function Gauge({ label, value, color }) {
      const r = 26
      const c = Math.PI * r
      const ratio = clamp(value, 0, 100) / 100
      return h('div', { className: 'tf-gauge' },
        h('svg', { viewBox: '0 0 64 40', 'aria-hidden': true },
          h('path', { d: 'M6 34 A26 26 0 0 1 58 34', fill: 'none', stroke: '#1b2a41', strokeWidth: 7, strokeLinecap: 'round' }),
          h('path', {
            d: 'M6 34 A26 26 0 0 1 58 34', fill: 'none', stroke: color, strokeWidth: 7, strokeLinecap: 'round',
            strokeDasharray: `${(c * ratio).toFixed(2)} ${c.toFixed(2)}`,
          }),
        ),
        h('div', { className: 'tf-gv' }, `${value > 0 && value < 10 ? value.toFixed(1) : Math.round(value)}%`),
        h('div', { className: 'tf-gl' }, label),
      )
    }

    function SessionBars({ sessions }) {
      const rows = (Array.isArray(sessions) ? sessions : [])
        .slice()
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 8)
      const max = Math.max(...rows.map((row) => row.cost), 1)
      return h('div', { className: 'tf-bars' },
        rows.length ? rows.map((row, i) => h('div', { className: 'tf-bar-row', key: `${row.title}-${i}` },
          h('div', { className: 'tf-bar-name', title: row.title },
            h('span', { className: `tf-dot${row.live ? '' : ' tf-dim'}` }),
            row.title,
          ),
          h('div', { className: 'tf-bar-track' },
            h('div', { className: 'tf-bar-fill', style: { width: `${Math.max(2, (row.cost / max) * 100)}%` } }),
          ),
          h('div', { className: 'tf-bar-cost' }, money(row.cost)),
        )) : h('div', { className: 'tf-bar-empty' }, 'no billable sessions in this book'),
      )
    }

    function SpiderWeb({ roles }) {
      const cx = 260, cy = 118, R = 82
      const nodes = roles.map((role, i) => {
        const angle = (Math.PI * 2 * i) / Math.max(roles.length, 1) - Math.PI / 2
        return { ...role, x: cx + Math.cos(angle) * R, y: cy + Math.sin(angle) * R }
      })
      return h('svg', { viewBox: '0 0 520 240', role: 'img', 'aria-label': 'Live DSH harness telemetry web' },
        h('defs', null,
          h('radialGradient', { id: 'tf-core' },
            h('stop', { offset: '0%', stopColor: '#5eead4' }),
            h('stop', { offset: '100%', stopColor: '#0f766e' }),
          ),
        ),
        nodes.map((node, i) => h('line', {
          key: `l${i}`, x1: cx, y1: cy, x2: node.x, y2: node.y, stroke: node.color, strokeOpacity: 0.28, strokeWidth: 1.2,
          strokeDasharray: i % 2 ? '3 4' : '0',
        })),
        nodes.map((node, i) => h('circle', {
          key: `p${i}`, r: 2.2, fill: node.color,
          children: h('animateMotion', {
            dur: `${3 + i * 0.4}s`, repeatCount: 'indefinite',
            path: `M${cx},${cy} L${node.x},${node.y}`,
          }),
        })),
        h('circle', { cx, cy, r: 28, fill: '#0a1322', stroke: '#2dd4bf', strokeWidth: 1.4 }),
        h('circle', { cx, cy, r: 20, fill: 'url(#tf-core)', opacity: 0.22 }),
        h('text', { x: cx, y: cy - 2, textAnchor: 'middle', fill: '#99f6e4', fontSize: 7.5, letterSpacing: 1 }, 'HARNESS'),
        h('text', { x: cx, y: cy + 8, textAnchor: 'middle', fill: '#5eead4', fontSize: 6, letterSpacing: 1 }, 'RUNTIME'),
        nodes.map((node, i) => h('g', { key: `n${i}` },
          h('circle', { cx: node.x, cy: node.y, r: 15, fill: '#0b1524', stroke: node.color, strokeOpacity: 0.65, strokeWidth: 1 }),
          h('circle', { cx: node.x, cy: node.y, r: 3, fill: node.color }),
          h('text', { x: node.x, y: node.y + 27, textAnchor: 'middle', fill: '#93a7bd', fontSize: 7, letterSpacing: 1 }, node.key),
        )),
        h('g', { className: 'tf-spider' },
          h('circle', { cx: 260, cy: 24, r: 3.2, fill: '#fbbf24' }),
          h('path', { d: 'M257 24l-6 -5M257 26l-6 5M263 24l6 -5M263 26l6 5', stroke: '#fbbf24', strokeWidth: 1 }),
        ),
      )
    }

    function Head({ clock, full, setFull, data, error }) {
      const state = data ? (error ? 'STALE' : 'LIVE') : error ? 'OFFLINE' : 'SYNCING'
      return h('div', { className: 'tf-head' },
        h('div', { className: 'tf-brand' },
          h('span', { className: `tf-live${state === 'LIVE' ? '' : ' tf-dim'}` }),
          'TRADING FLOOR',
          h('span', { className: state === 'LIVE' ? 'tf-livebadge' : 'tf-mock' }, state === 'LIVE' ? 'LIVE · DSH' : state),
        ),
        h('div', { className: 'tf-headright' },
          h('div', { className: 'tf-clock' }, `DESK OPEN · ${clock} CST`),
          h('button', { type: 'button', className: 'tf-btn tf-expand', onClick: () => setFull((value) => !value) }, full ? 'EXIT' : 'FULL DESK'),
        ),
      )
    }

    function Footer({ data, error }) {
      const sample = data?.sample
      return h('div', { className: 'tf-foot' },
        h('span', null, sample ? `ACTIVE BOOK · ${sample.active} sessions / ${sample.items} seen · lifetime usage · idle-rate estimate` : 'LIVE DSH · waiting for data'),
        h('span', null, error ? `stale · ${error}` : 'read-only · no market data · no orders'),
      )
    }

    function TradingFloor() {
      const clock = useClock()
      const { data, error, reload } = useTelemetry()
      const [full, setFull] = useState(false)
      const [note, setNote] = useState('')
      const gauges = useMemo(() => data ? [
        { label: 'CONTEXT', value: clamp((data.totals.ctxShare ?? 0) * 100, 0, 100), color: '#22d3ee' },
        { label: 'CACHE HIT', value: clamp((data.totals.cacheHit ?? 0) * 100, 0, 100), color: '#34d399' },
        { label: 'OUTPUT', value: clamp((data.totals.outputShare ?? 0) * 100, 0, 100), color: '#a78bfa' },
        { label: 'TOOL TIME', value: clamp((data.totals.toolShare ?? 0) * 100, 0, 100), color: '#fbbf24' },
      ] : [], [data])

      useEffect(() => {
        if (!full) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          setFull(false)
        }
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        window.addEventListener('keydown', onKey, true)
        return () => {
          window.removeEventListener('keydown', onKey, true)
          document.body.style.overflow = previous
        }
      }, [full])

      const copySummary = async () => {
        if (!data) return
        const summary = [
          `DSH Trading Floor · ${data.window.label}`,
          `active ${data.sample.active} · live ${data.sample.live} · steps ${data.totals.steps}`,
          `tokens ${compact(data.totals.tokens)} · cache ${pct(data.totals.cacheHit)} · ctx ${pct(data.totals.ctxShare)}`,
          `idle-rate spend ${money(data.totals.cost)} / budget ${money(data.budget.cny)}`,
        ].join('\n')
        try {
          await navigator.clipboard.writeText(summary)
          setNote('Snapshot summary copied')
        } catch {
          setNote('Clipboard unavailable')
        }
        setTimeout(() => setNote(''), 2500)
      }

      const shell = (content) => h('div', { className: `tf-root${full ? ' tf-full' : ''}` },
        h('style', null, CSS),
        h(Head, { clock, full, setFull, data, error }),
        error && data ? h('div', { className: 'tf-banner' },
          h('span', null, `Telemetry stale: ${error}`),
          h('button', { type: 'button', className: 'tf-btn', onClick: reload }, 'RETRY'),
        ) : null,
        content,
        h(Footer, { data, error }),
      )

      if (!data) {
        return shell(h('div', { className: 'tf-card tf-empty' },
          h('h2', null, error ? 'NO SIGNAL' : 'CONNECTING TO THE DESK'),
          h('p', null, error || 'Reading live DSH session projections…'),
          h('button', { type: 'button', className: 'tf-btn tf-expand', onClick: reload }, 'RETRY'),
        ))
      }

      const content = h(React.Fragment, null,
        h('div', { className: 'tf-ticker' },
          data.ticker.map((item) => h('div', { className: 'tf-tick', key: item.s },
            h('div', { className: 'tf-sym' }, item.s),
            h('div', { className: 'tf-px' }, item.v),
            h('div', { className: `tf-chg tf-${item.tone}` }, item.sub),
          )),
        ),
        h('div', { className: 'tf-grid' },
          h('aside', { className: 'tf-agents' },
            h('div', { className: 'tf-card' },
              h('h3', null, 'DSH DESK · SIX LENSES'),
              data.roles.map((role) => h('div', { className: 'tf-agent', key: role.key },
                h('span', { className: 'tf-dot', style: { background: role.color, boxShadow: `0 0 8px ${role.color}66` } }),
                h('div', null,
                  h('div', { className: 'tf-aname' }, role.key),
                  h('div', { className: 'tf-arole' }, role.label),
                ),
                h('div', { className: 'tf-aright' },
                  h('div', { className: 'tf-apnl', style: { color: role.color } }, role.metric),
                  h('div', { className: 'tf-astat' }, role.unit),
                  h('div', { className: 'tf-atok' }, role.sub),
                ),
              )),
            ),
            h('div', { className: 'tf-card' },
              h('h3', null, 'RISK LIMITS'),
              data.checks.map((check) => h('div', { className: 'tf-log', key: check.key },
                h('span', { className: 'tf-lt' }, check.label),
                h('span', { className: `tf-check tf-${check.status}` }, check.value),
              )),
            ),
            full ? h('div', { className: 'tf-card' },
              h('h3', null, 'RECENT SESSIONS'),
              data.recent.slice(0, 4).map((session, i) => h('div', { className: 'tf-recent-row', key: `${session.title}-${i}` },
                h('span', { className: `tf-dot${session.live ? '' : ' tf-dim'}` }),
                h('div', { className: 'tf-recent-main' },
                  h('div', { className: 'tf-recent-title' }, session.title),
                  h('div', { className: 'tf-atok' }, `${session.cwd} · ${session.preset} · ${session.steps} steps`),
                ),
                h('div', { className: 'tf-recent-cost' }, money(session.cost)),
              )),
            ) : null,
          ),
          h('main', { className: 'tf-center' },
            h('div', { className: 'tf-card tf-chartwrap' },
              h('h3', null, 'ACTIVE BOOK · LIFETIME SPEND (IDLE EST)'),
              h('span', { className: 'tf-badge' }, `${money(data.totals.cost)} · ${data.sample.active} sessions`),
              h(SessionBars, { sessions: data.bars }),
            ),
            h('div', { className: 'tf-gauges' }, gauges.map((gauge) => h(Gauge, { key: gauge.label, ...gauge }))),
            h('div', { className: 'tf-card tf-web' },
              h('h3', null, 'ORCHESTRATION · HARNESS TELEMETRY'),
              h(SpiderWeb, { roles: data.roles }),
              h('div', { className: 'tf-foot' },
                h('span', null, '6 lenses → session log → daily budget'),
                h('span', { style: { color: '#fbbf24' } }, '● live projections'),
              ),
            ),
          ),
          h('aside', { className: 'tf-side' },
            h('div', { className: 'tf-card tf-approval' },
              h('h3', null, 'HUMAN GATE · LIVE STATE'),
              data.checks.map((check) => h('div', { className: `tf-appr tf-${check.status}`, key: check.key },
                h('div', { className: 'tf-appr-top' }, h('b', null, check.label), h('span', null, check.status.toUpperCase())),
                h('div', { className: 'tf-appr-sub' }, check.detail),
              )),
              h('div', { className: 'tf-actions' },
                h('button', { type: 'button', className: 'tf-btn ok', onClick: reload }, 'REFRESH'),
                h('button', { type: 'button', className: 'tf-btn', onClick: copySummary }, 'COPY'),
              ),
              h('div', { className: 'tf-decision' }, note || `Policy ${data.current?.permission ?? 'unknown'} · goal ${data.current?.goalPhase ?? 'none'} · ${data.current?.questions ?? 0} question(s)`),
              h('div', { className: 'tf-foot' }, h('span', null, 'read-only · no orders · no broker')),
            ),
            h('div', { className: 'tf-card' },
              h('h3', null, 'LIVE DESK LOG · LAST PROMPT'),
              h('div', { className: 'tf-logs' }, data.logs.length ? data.logs.map((log, i) => h('div', { className: 'tf-log', key: `${log.at}-${i}` },
                h('span', { className: 'tf-lt' }, log.t),
                h('span', { className: `tf-logline tf-tone-${log.tone}` }, log.text),
              )) : h('div', { className: 'tf-log' }, h('span', null, 'waiting for session activity'))),
            ),
          ),
        ),
      )
      return shell(content)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'trading-floor',
          order: 30,
          label: 'Trading Floor',
        }, TradingFloor))
      },
      // Exposed for the pure projection fold test; the Loader ignores extra fields.
      buildSnapshot,
    }
  },
})
