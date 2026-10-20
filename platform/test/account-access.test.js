'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function harness() {
  const elements = new Map();
  const stored = new Map();
  const byId = id => {
    if (!elements.has(id)) elements.set(id, {value: '', checked: false, type: 'password',
      classList: {toggle() {}}, setAttribute(name, value) { this[name] = value; }});
    return elements.get(id);
  };
  const context = vm.createContext({byId, state: {account: {id: 'test'}, profile: {visible: true, social: {shareApproximateLocation: true}}, globalPresenceCountryCode: 'CO'},
    all: () => [], localizedUiText: value => value, setStatus() {},
    isNativeAndroidApp: () => false,
    globalCountryName: () => 'Colombia <script>bad</script>', storedGlobalCountryCode: () => 'CO',
    localStorage: {getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key)},
  });
  for (const name of ['escapeAttribute', 'renderGlobalPresenceControl', 'setPasswordVisible', 'setAccountPasswordVisible', 'rememberAccountEmail', 'restoreRememberedAccountEmail', 'setAuthMode']) {
    const start = source.indexOf(`function ${name}(`);
    const next = source.slice(start + 1).search(/\n(?:async )?function /);
    vm.runInContext(source.slice(start, start + next + 1), context);
  }
  return {context, byId, stored};
}

test('authenticated account with country sharing renders without escapeHtml crash and escapes names', () => {
  const h = harness();
  assert.doesNotThrow(() => h.context.renderGlobalPresenceControl());
  assert.match(h.byId('shareGlobalCountry').innerHTML, /Colombia &lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(h.byId('shareGlobalCountry').innerHTML, /<script>/);
});

test('show/hide keeps the password unchanged, never submits, and auth mode restores masking', () => {
  const h = harness();
  h.byId('accountPassword').value = 'dummy-local-password';
  h.context.setAccountPasswordVisible(true);
  assert.equal(h.byId('accountPassword').type, 'text');
  assert.equal(h.byId('toggleAccountPassword')['aria-pressed'], 'true');
  h.context.setAuthMode('login');
  assert.equal(h.byId('accountPassword').type, 'password');
  assert.equal(h.byId('accountPassword').value, 'dummy-local-password');
  assert.equal(h.byId('accountPassword').autocomplete, 'current-password');
  assert.equal(h.byId('accountPassword').minLength, 1);
  h.context.setAuthMode('register');
  assert.equal(h.byId('accountPassword').autocomplete, 'new-password');
  assert.equal(h.byId('accountPassword').minLength, 10);
});

test('remembered email survives reload without storing a password and opt-out removes it', () => {
  const h = harness();
  h.byId('accountEmail').value = ' example@example.test ';
  h.byId('accountPassword').value = 'dummy-local-password';
  h.byId('rememberAccountEmail').checked = true;
  h.context.rememberAccountEmail();
  assert.deepEqual([...h.stored], [['qsession-remembered-email', 'example@example.test']]);
  h.byId('accountEmail').value = '';
  assert.equal(h.context.restoreRememberedAccountEmail(), true);
  assert.equal(h.byId('accountEmail').value, 'example@example.test');
  h.byId('accountEmail').value = 'manager@example.test';
  h.context.restoreRememberedAccountEmail();
  assert.equal(h.byId('accountEmail').value, 'manager@example.test', 'do not overwrite password-manager autofill');
  h.byId('rememberAccountEmail').checked = false;
  h.context.rememberAccountEmail();
  assert.equal(h.stored.size, 0);
});

test('blocked local storage does not prevent sign-in or form initialization', () => {
  const h = harness();
  h.context.localStorage = {getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); }};
  assert.equal(h.context.restoreRememberedAccountEmail(), false);
  assert.doesNotThrow(() => h.context.rememberAccountEmail());
  assert.doesNotThrow(() => h.context.setAuthMode('login'));
});
