/**
 * Deterministic unit tests for NodeHealthTracker:
 * - Per-API cooldown
 * - Head-block staleness (median-based)
 * - API failure aging
 */

import { NodeHealthTracker } from '../src/helpers/call.js'

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  \u2705 ${msg}`)
    passed++
  } else {
    console.error(`  \u274c ${msg}`)
    failed++
  }
}

function assertArrayEq(actual: string[], expected: string[], msg: string) {
  assert(
    actual.length === expected.length && actual.every((v, i) => v === expected[i]),
    `${msg} (got [${actual.join(', ')}], expected [${expected.join(', ')}])`
  )
}

console.log('Testing NodeHealthTracker...\n')

// ── Basic health ───────────────────────────────────────────────────────────
console.log('Basic health:')
{
  const t = new NodeHealthTracker()
  assert(t.isNodeHealthy('https://a') === true, 'unknown node is healthy')
}
{
  const t = new NodeHealthTracker()
  t.recordFailure('https://a')
  t.recordFailure('https://a')
  assert(t.isNodeHealthy('https://a') === true, '2 failures still healthy')
  t.recordFailure('https://a')
  assert(t.isNodeHealthy('https://a') === false, '3 failures -> unhealthy')
}
{
  const t = new NodeHealthTracker()
  t.recordFailure('https://a')
  t.recordFailure('https://a')
  t.recordSuccess('https://a')
  t.recordFailure('https://a')
  assert(t.isNodeHealthy('https://a') === true, 'success resets failure count')
}
{
  const t = new NodeHealthTracker()
  t.recordRateLimit('https://a', 5000)
  assert(t.isNodeHealthy('https://a') === false, 'rate-limited node is unhealthy')
}

// ── Per-API cooldown ───────────────────────────────────────────────────────
console.log('\nPer-API cooldown:')
{
  const t = new NodeHealthTracker()
  t.recordFailure('https://a', 'rc_api')
  assert(t.isNodeHealthy('https://a', 'rc_api') === true, '1 API failure still healthy')
  t.recordFailure('https://a', 'rc_api')
  assert(t.isNodeHealthy('https://a', 'rc_api') === false, '2 API failures -> cooldown')
}
{
  const t = new NodeHealthTracker()
  t.recordFailure('https://a', 'rc_api')
  t.recordFailure('https://a', 'rc_api')
  assert(t.isNodeHealthy('https://a', 'rc_api') === false, 'rc_api in cooldown')
  assert(t.isNodeHealthy('https://a', 'condenser_api') === true, 'condenser_api still healthy')
  assert(t.isNodeHealthy('https://a') === true, 'globally still healthy (no API)')
}
{
  const t = new NodeHealthTracker()
  t.recordFailure('https://a', 'rc_api')
  t.recordFailure('https://a', 'rc_api')
  assert(t.isNodeHealthy('https://a', 'rc_api') === false, 'in cooldown before success')
  t.recordSuccess('https://a', 'rc_api')
  assert(t.isNodeHealthy('https://a', 'rc_api') === true, 'success clears API cooldown')
}
{
  // Sparse failures >30s apart should reset counter (not accumulate)
  const t = new NodeHealthTracker()
  t.recordFailure('https://a', 'rc_api')
  // Simulate 31s passing
  const h = (t as any).health.get('https://a')
  const apiFail = h.apiFailures.get('rc_api')
  apiFail.lastFailureTime = Date.now() - 31_000
  // Next failure should reset counter to 1, not accumulate to 2
  t.recordFailure('https://a', 'rc_api')
  assert(t.isNodeHealthy('https://a', 'rc_api') === true, 'sparse failures reset counter (no sticky penalty)')
}

// ── getOrderedNodes with API ───────────────────────────────────────────────
console.log('\ngetOrderedNodes with API:')
{
  const t = new NodeHealthTracker()
  const nodes = ['https://a', 'https://b', 'https://c']
  t.recordFailure('https://b', 'rc_api')
  t.recordFailure('https://b', 'rc_api')
  const ordered = t.getOrderedNodes(nodes, 'rc_api')
  assertArrayEq(ordered, ['https://a', 'https://c', 'https://b'], 'deprioritizes API-cooled node')
}
{
  const t = new NodeHealthTracker()
  const nodes = ['https://a', 'https://b']
  t.recordFailure('https://a', 'rc_api')
  t.recordFailure('https://a', 'rc_api')
  const ordered = t.getOrderedNodes(nodes, 'condenser_api')
  assertArrayEq(ordered, ['https://a', 'https://b'], 'no deprioritization for unrelated API')
}

// ── Head-block staleness (median-based) ────────────────────────────────────
console.log('\nHead-block staleness:')
{
  const t = new NodeHealthTracker()
  t.recordHeadBlock('https://a', 100)
  assert(t.isNodeHealthy('https://a') === true, 'single observation: no staleness check')
}
{
  const t = new NodeHealthTracker()
  t.recordHeadBlock('https://a', 100)
  t.recordHeadBlock('https://b', 120)
  assert(t.isNodeHealthy('https://a') === true, 'within threshold (20 behind median)')
}
{
  const t = new NodeHealthTracker()
  t.recordHeadBlock('https://a', 50)
  t.recordHeadBlock('https://b', 100)
  t.recordHeadBlock('https://c', 105)
  // Median of [50, 100, 105] = 100 (lower-middle). 50 is 50 behind -> stale
  assert(t.isNodeHealthy('https://a') === false, 'node 50 blocks behind median -> stale')
  assert(t.isNodeHealthy('https://b') === true, 'node at median -> healthy')
  assert(t.isNodeHealthy('https://c') === true, 'node ahead of median -> healthy')
}
{
  // Poisoning resistance: 1 inflated node among 3 honest
  const t = new NodeHealthTracker()
  t.recordHeadBlock('https://honest-1', 100)
  t.recordHeadBlock('https://honest-2', 101)
  t.recordHeadBlock('https://honest-3', 99)
  t.recordHeadBlock('https://malicious', 999999)
  // Sorted: [99, 100, 101, 999999]. Median (lower-middle) = 100
  assert(t.isNodeHealthy('https://honest-1') === true, 'honest-1 not poisoned')
  assert(t.isNodeHealthy('https://honest-2') === true, 'honest-2 not poisoned')
  assert(t.isNodeHealthy('https://honest-3') === true, 'honest-3 not poisoned')
  assert(t.isNodeHealthy('https://malicious') === true, 'malicious ahead, not stale')
}
{
  const t = new NodeHealthTracker()
  const nodes = ['https://stale', 'https://fresh-1', 'https://fresh-2']
  t.recordHeadBlock('https://stale', 50)
  t.recordHeadBlock('https://fresh-1', 100)
  t.recordHeadBlock('https://fresh-2', 102)
  const ordered = t.getOrderedNodes(nodes)
  assertArrayEq(ordered, ['https://fresh-1', 'https://fresh-2', 'https://stale'], 'stale node deprioritized in ordering')
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\nHealth tracker tests: ${passed}/${passed + failed} passed`)
if (failed > 0) {
  console.error(`${failed} test(s) FAILED`)
  process.exit(1)
}
