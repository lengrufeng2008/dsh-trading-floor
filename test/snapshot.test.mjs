import test from 'node:test'
import assert from 'node:assert/strict'

const React = {
  createElement: () => null,
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
}
const ReactDOM = { createPortal: () => null }
let plugin

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      plugin = definition.factory((id) => {
        if (id === 'react') return React
        if (id === 'react-dom') return ReactDOM
        throw new Error(`unexpected module: ${id}`)
      })
    },
  },
}

await import('../client.js')

const now = Date.UTC(2026, 9, 31, 8, 0, 0) // 16:00 Beijing, a Saturday
const old = now - 2 * 86400_000

function item(overrides = {}) {
  return {
    sessionId: 'session-a',
    updatedAt: now - 1000,
    running: true,
    cwd: '/home/lrf/Miner',
    projections: {
      values: {
        title: 'Alpha session',
        tokenUsage: {
          cacheReadTokens: 100_000_000,
          uncachedInputTokens: 1_000_000,
          outputTokens: 500_000,
          cacheWriteTokens: 0,
        },
        contextPressure: { pressureTokens: 200_000, projectedTokens: 210_000, contextWindow: 1_000_000 },
        sessionStats: { steps: 10, turns: 2, llmMs: 1000, toolMs: 3000 },
        modelSelection: { lastUsed: { provider: 'deepseek-official', model: 'deepseek-flash' } },
        agentPreset: 'cordis',
        permissions: { currentValue: 'workspace-write' },
        goal: { goal: { phase: 'active' } },
        userQuestions: { active: [], settled: [] },
        subagentCatalog: [{ label: 'Scout', createdAt: now - 5000 }],
      },
    },
    ...overrides,
  }
}

test('folds live session projections into a book snapshot', () => {
  const snapshot = plugin.buildSnapshot([item()], now)
  assert.equal(snapshot.version, 2)
  assert.equal(snapshot.sample.active, 1)
  assert.equal(snapshot.sample.live, 1)
  assert.equal(snapshot.totals.tokens, 101_500_000)
  assert.equal(snapshot.totals.cost, 5)
  assert.equal(snapshot.totals.steps, 10)
  assert.equal(snapshot.totals.ctxShare, 0.2)
  assert.equal(snapshot.totals.toolShare, 0.75)
  assert.equal(snapshot.roles.length, 6)
  assert.equal(snapshot.roles.find((role) => role.key === 'PM').metric, '¥5.00')
  assert.equal(snapshot.checks.length, 3)
  assert.equal(snapshot.budget.status, 'inside')
  assert.equal(snapshot.current.permission, 'workspace-write')
  assert.equal(snapshot.current.goalPhase, 'active')
  assert.equal(snapshot.recent[0].title, 'Alpha session')
  assert.equal(snapshot.bars[0].title, 'Alpha session')
  assert.equal(snapshot.bars[0].cost, 5)
  assert.ok(snapshot.logs.some((log) => log.text.includes('Alpha session')))
  assert.ok(snapshot.logs.some((log) => log.text.includes('Scout')))
})

test('excludes sessions whose activity is older than today', () => {
  const snapshot = plugin.buildSnapshot([item({ sessionId: 'session-old', updatedAt: old, running: false })], now)
  assert.equal(snapshot.sample.active, 0)
  assert.equal(snapshot.sample.items, 1)
  assert.equal(snapshot.totals.cost, 0)
  assert.equal(snapshot.recent.length, 0)
})

test('keeps an empty desk renderable', () => {
  const snapshot = plugin.buildSnapshot([], now)
  assert.equal(snapshot.sample.active, 0)
  assert.equal(snapshot.roles.length, 6)
  assert.equal(snapshot.logs.length, 0)
})

test('marks a book over budget and near the context cap', () => {
  const heavy = item({
    projections: {
      values: {
        title: 'Heavy',
        tokenUsage: { cacheReadTokens: 6_000_000_000, uncachedInputTokens: 10_000_000, outputTokens: 1_000_000 },
        contextPressure: { pressureTokens: 900_000, contextWindow: 1_000_000 },
        sessionStats: { steps: 1, turns: 1, llmMs: 1, toolMs: 1 },
        modelSelection: { lastUsed: { model: 'deepseek-v4-pro' } },
        permissions: { currentValue: 'danger-full-access' },
        goal: { goal: { phase: 'active' } },
      },
    },
  })
  const snapshot = plugin.buildSnapshot([heavy], now)
  assert.equal(snapshot.budget.status, 'over')
  assert.equal(snapshot.checks.find((check) => check.key === 'CONTEXT').status, 'near')
})
