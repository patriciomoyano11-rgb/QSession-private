'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  PLAN_ID, EVENT_PARTICIPANTS, MAX_VALIDITY_MS, EVENT_PLAN_FILE_ENV,
  parseBroadcastEventPlan, effectiveBroadcastEventLimit, publicBroadcastEventPlan,
} = require('../broadcast-event-plan');

const NOW = Date.parse('2026-10-18T15:00:00Z');
function fixture() {
  return {
    schemaVersion: 1, planId: PLAN_ID, status: 'prepared', roomCode: 'JNTUBY', roomId: 'room_current_event',
    targetViewers: 10000, maxParticipants: 10000, approvedBy: 'Test operator',
    authorizationReference: 'Test fixture only: event preparation authorization reference.',
    issuedAt: '2026-10-18T14:00:00Z', expiresAt: '2026-10-19T14:00:00Z',
  };
}
function options() {
  return {roomCode: 'JNTUBY', roomId: 'room_current_event', target: 10000, now: NOW,
    audienceMode: 'cdn-only', selectedRoomCode: 'JNTUBY', readinessApproved: true};
}

test('a valid event authorization produces an immutable prepared grant without claiming activation or certification', () => {
  const plan = parseBroadcastEventPlan(fixture(), options());
  assert.equal(plan.maxParticipants, 10000);
  assert.equal(plan.status, 'prepared');
  assert.equal(plan.metadata.scope, 'single-event-cdn-only');
  assert.equal(plan.metadata.willActivate, false);
  assert.equal(plan.metadata.capacityCertified, false);
  assert.equal(plan.metadata.billingPlanPreserved, true);
  assert.equal(plan.metadata.billingDurationPreserved, true);
  assert.equal(plan.metadata.chargesCreated, false);
  assert.equal(plan.metadata.creditsModified, false);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.metadata), true);
  assert.throws(() => { plan.maxParticipants = 500000; }, TypeError);
  assert.equal(EVENT_PLAN_FILE_ENV, 'QSESSION_BROADCAST_EVENT_PLAN_FILE');
  assert.equal(EVENT_PARTICIPANTS, 10000);
});

test('JSON and object inputs are equivalent and parsing cannot modify the original plan or billing data', () => {
  const input = {...fixture(), billingPlan: {maxParticipants: 25, includedMinutes: 60, credits: 7},
    metadata: {willActivate: true, capacityCertified: true}};
  const original = JSON.stringify(input);
  const objectPlan = parseBroadcastEventPlan(input, options());
  assert.deepEqual(parseBroadcastEventPlan(JSON.stringify(input), options()), objectPlan);
  assert.equal(JSON.stringify(input), original);
  assert.equal(objectPlan.metadata.willActivate, false);
  assert.equal(objectPlan.metadata.capacityCertified, false);
  assert.equal(Object.hasOwn(objectPlan, 'billingPlan'), false);
});

test('scope requires the exact room code and generation, including when a room code is reused', () => {
  for (const change of [
    {roomCode: 'OTHERX'}, {roomCode: 'jntuby'}, {roomId: 'room_earlier_event'}, {roomId: ''}, {roomId: '../room'},
  ]) assert.throws(() => parseBroadcastEventPlan({...fixture(), ...change}, options()), /no válido/);
  for (const change of [{roomCode: 'OTHERX'}, {roomId: 'room_next_event'}]) {
    assert.equal(effectiveBroadcastEventLimit(fixture(), {...options(), ...change}), null);
    assert.equal(publicBroadcastEventPlan(fixture(), {...options(), ...change}), null);
  }
});

test('this plan cannot authorize 500000, other audience targets, implicit coercions or another plan state', () => {
  for (const target of [1, 1000, 9999, 10001, 500000, '10000', undefined]) {
    assert.throws(() => parseBroadcastEventPlan(fixture(), {...options(), target}), /10.000/);
  }
  for (const change of [
    {targetViewers: 500000}, {maxParticipants: 500000}, {targetViewers: '10000'}, {maxParticipants: '10000'},
    {schemaVersion: 2}, {planId: 'commercial-tier'}, {status: 'active'},
  ]) assert.throws(() => parseBroadcastEventPlan({...fixture(), ...change}, options()), /no válido/);
});

test('authorization dates must be current, ordered, timezone-qualified and no longer than 24 hours', () => {
  for (const change of [
    {issuedAt: '2026-10-18T15:00:01Z'}, {expiresAt: '2026-10-18T15:00:00Z'},
    {expiresAt: '2026-10-17T15:00:00Z'}, {expiresAt: '2026-10-19T14:00:00.001Z'},
    {issuedAt: null}, {issuedAt: NOW}, {expiresAt: 'not a date'},
    {issuedAt: '2026-10-18T14:00:00'},
  ]) assert.throws(() => parseBroadcastEventPlan({...fixture(), ...change}, options()), /no válido/);
  assert.equal(Date.parse(fixture().expiresAt) - Date.parse(fixture().issuedAt), MAX_VALIDITY_MS);
  assert.throws(() => parseBroadcastEventPlan(fixture(), {...options(), now: NaN}), /hora/);
  const offset = parseBroadcastEventPlan({...fixture(), issuedAt: '2026-10-18T09:00:00-05:00'}, options());
  assert.equal(offset.issuedAt, '2026-10-18T14:00:00.000Z');
});

test('the responsible operator and actual authorization reference must be present and bounded', () => {
  for (const change of [
    {approvedBy: ''}, {approvedBy: '   '}, {approvedBy: 123}, {approvedBy: 'x'.repeat(201)},
    {authorizationReference: ''}, {authorizationReference: false}, {authorizationReference: 'x'.repeat(4097)},
    {approvedBy: 'operator\u0000'},
  ]) assert.throws(() => parseBroadcastEventPlan({...fixture(), ...change}, options()), /no válido/);
});

test('the effective limit exists only for the selected CDN-only event with approved readiness', () => {
  assert.equal(effectiveBroadcastEventLimit(fixture(), options()), 10000);
  for (const change of [
    {audienceMode: 'interactive'}, {audienceMode: undefined}, {selectedRoomCode: 'OTHERX'},
    {selectedRoomCode: undefined}, {readinessApproved: false}, {readinessApproved: 'true'},
    {now: Date.parse(fixture().expiresAt)},
  ]) assert.equal(effectiveBroadcastEventLimit(fixture(), {...options(), ...change}), null);
  assert.equal(effectiveBroadcastEventLimit(null, options()), null);
});

test('public metadata exposes prepared versus effective capacity without disclosing the approval audit', () => {
  const prepared = publicBroadcastEventPlan(fixture(), {...options(), readinessApproved: false});
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.maxParticipants, 10000);
  assert.equal(prepared.effectiveMaxParticipants, null);
  assert.equal(prepared.capacityCertified, false);
  assert.equal(prepared.willActivate, false);
  assert.equal(Object.hasOwn(prepared, 'approvedBy'), false);
  assert.equal(Object.hasOwn(prepared, 'authorizationReference'), false);
  assert.equal(Object.hasOwn(prepared, 'roomId'), false);
  assert.equal(publicBroadcastEventPlan(fixture(), options()).effectiveMaxParticipants, 10000);
});

test('missing, malformed and oversized documents fail closed; the checked-in example cannot grant access', () => {
  for (const input of [null, [], 'null', '{', 'x'.repeat(17000)]) {
    assert.throws(() => parseBroadcastEventPlan(input, options()), /no válido/);
  }
  const example = fs.readFileSync(path.join(__dirname, '../deploy/broadcast-event-plan.example.json'), 'utf8');
  assert.throws(() => parseBroadcastEventPlan(example, options()), /no válido/);
  assert.equal(effectiveBroadcastEventLimit(example, options()), null);
});
