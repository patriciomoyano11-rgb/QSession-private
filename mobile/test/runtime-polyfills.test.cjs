const assert = require('node:assert/strict');
const test = require('node:test');

const { installRuntimePolyfills } = require('../src/runtimePolyfills');

test('installs a usable WeakRef fallback when the runtime does not provide one', () => {
  const runtime = {};
  const value = { room: 'Q Session' };

  installRuntimePolyfills(runtime);
  const reference = new runtime.WeakRef(value);

  assert.equal(reference.deref(), value);
});

test('preserves a native WeakRef implementation', () => {
  class NativeWeakRef {}
  const runtime = { WeakRef: NativeWeakRef };

  installRuntimePolyfills(runtime);

  assert.equal(runtime.WeakRef, NativeWeakRef);
});
