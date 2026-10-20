/**
 * Runtime compatibility required before loading LiveKit.
 *
 * Hermes in the current Android build does not expose WeakRef, while
 * livekit-client 2.22 uses it internally for its connection state machine.
 * This fallback intentionally keeps a strong reference for the lifetime of
 * the JavaScript session. QSession closes and releases its Room explicitly, so
 * that trade-off is preferable to making Android unable to enter a room.
 */
function installRuntimePolyfills(target) {
  if (typeof target.WeakRef === 'undefined') {
    target.WeakRef = class QSessionWeakRef {
      constructor(value) {
        if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
          throw new TypeError('WeakRef target must be an object');
        }
        this.value = value;
      }

      deref() {
        return this.value;
      }
    };
  }

  return target;
}

installRuntimePolyfills(globalThis);

module.exports = { installRuntimePolyfills };
