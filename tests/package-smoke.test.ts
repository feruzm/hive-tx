/**
 * Smoke test: validates that the built ESM package exports resolve correctly.
 * Catches broken exports maps, missing dist files, or wrong entry points.
 * Requires build:esm to have run first.
 */
export {}

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`)
    passed++
  } else {
    console.error(`  ❌ ${msg}`)
    failed++
  }
}

console.log('Package smoke test...\n')

const esm = await import('../dist/esm/index.js')

assert(typeof esm.Transaction === 'function', 'Transaction exported')
assert(typeof esm.PrivateKey === 'function', 'PrivateKey exported')
assert(typeof esm.PublicKey === 'function', 'PublicKey exported')
assert(typeof esm.Signature === 'function', 'Signature exported')
assert(typeof esm.Memo !== 'undefined', 'Memo exported')
assert(typeof esm.callRPC === 'function', 'callRPC exported')
assert(typeof esm.callREST === 'function', 'callREST exported')
assert(typeof esm.callWithQuorum === 'function', 'callWithQuorum exported')
assert(typeof esm.config === 'object', 'config exported')
assert(typeof esm.utils === 'object', 'utils exported')

console.log(`\nPackage smoke tests: ${passed}/${passed + failed} passed`)
if (failed > 0) {
  console.error(`${failed} test(s) FAILED`)
  process.exit(1)
}
