'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const timeline = require('../audio-timeline');

test('a late listener starts one target buffer behind the live edge, on a frame boundary', () => {
  const playhead = timeline.lateJoinPlayhead(1_000, 11_010);
  assert.equal(playhead, 1_000 + Math.floor((11_010 - timeline.TARGET_BUFFER_MS - 1_000) / 20) * 20);
  assert.equal(playhead % 20, 0);
  assert.ok(playhead > 1_000);
  assert.ok(11_010 - playhead >= timeline.TARGET_BUFFER_MS);
  assert.ok(11_010 - playhead < timeline.TARGET_BUFFER_MS + timeline.FRAME_MS);
});

test('half the control-plane RTT is the only clock offset', () => {
  assert.equal(timeline.estimateSenderNow(1_000, 1_080, 5_000), 5_040);
});

test('a fast clock is corrected by at most 0.2 percent and the pair stays inside 40 ms', () => {
  const pair = timeline.compare({
    durationMs: 30_000,
    drift: 1.002,
    joinAtSenderMs: 200,
  }, {
    durationMs: 30_000,
    drift: 1,
    joinAtSenderMs: 200,
  });
  assert.ok(pair.a.maxAbsStretch <= timeline.MAX_STRETCH);
  assert.ok(pair.b.maxAbsStretch <= timeline.MAX_STRETCH);
  assert.equal(pair.a.jumps, 0);
  assert.equal(pair.b.jumps, 0);
  assert.ok(pair.p95Ms <= 40, `p95 ${pair.p95Ms}`);
});

test('the controller rejects a catch-up faster than 0.2 percent', () => {
  const session = timeline.createSession(0);
  timeline.join(session, 200);
  assert.throws(() => timeline.setStretch(session, 0.1), {code: 'stretch-limit'});
  assert.equal(session.stretch, 0);
});

test('one missing frame is concealed and three missing frames are a gap without a jump', () => {
  const one = timeline.simulate({
    durationMs: 2_000,
    joinAtSenderMs: 200,
    drop: frame => frame === 20,
  });
  assert.equal(one.session.concealed, 1);
  assert.equal(one.session.gaps, 0);
  assert.equal(one.session.jumps, 0);
  assert.equal(one.session.discontinuities, 0);

  const three = timeline.simulate({
    durationMs: 2_000,
    joinAtSenderMs: 200,
    drop: frame => frame >= 30 && frame <= 32,
  });
  assert.equal(three.session.gaps, 1);
  assert.equal(three.session.jumps, 0);
  assert.ok(three.session.maxAbsStretch <= timeline.MAX_STRETCH);
  assert.equal(three.session.discontinuities, 0);
});

test('a hole longer than one second reanchors instead of speeding up', () => {
  const dropped = new Set();
  for (let frame = 40; frame < 40 + 60; frame += 1) dropped.add(frame);
  const run = timeline.simulate({
    durationMs: 4_000,
    joinAtSenderMs: 200,
    drop: frame => dropped.has(frame),
  });
  assert.ok(run.session.discontinuities >= 1);
  assert.ok(run.session.maxAbsStretch <= timeline.MAX_STRETCH);
  assert.equal(run.session.jumps, 0);
});

test('a clock the 0.2 percent limit cannot follow stays outside 40 ms', () => {
  const pair = timeline.compare({
    durationMs: 20_000,
    drift: 1.01,
    joinAtSenderMs: 200,
  }, {
    durationMs: 20_000,
    drift: 1,
    joinAtSenderMs: 200,
  });
  assert.ok(pair.a.maxAbsStretch <= timeline.MAX_STRETCH);
  assert.ok(pair.p95Ms > 40);
});

test('two corrected listeners report p95 and p99 of their playhead skew', () => {
  const pair = timeline.compare({
    durationMs: 20_000,
    drift: 1.001,
    joinAtSenderMs: 200,
  }, {
    durationMs: 20_000,
    drift: 0.999,
    joinAtSenderMs: 200,
  });
  assert.ok(pair.p95Ms <= 40, `p95 ${pair.p95Ms}`);
  assert.ok(pair.p99Ms <= 80, `p99 ${pair.p99Ms}`);
  assert.equal(pair.a.discontinuities, 0);
  assert.equal(pair.b.discontinuities, 0);
});
