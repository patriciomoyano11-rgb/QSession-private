'use strict';

// Local clock for one shared 20 ms timeline. No sockets, no decoder, no capacity claim.
const FRAME_MS = 20;
const TARGET_BUFFER_MS = 200;
const MAX_STRETCH = 0.002;
const ERROR_THRESHOLD_MS = 15;
const ERROR_HOLD_MS = 1000;
const RESET_GAP_MS = 1000;

function mediaTime(epochMs, frameIndex) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) throw new TypeError('La trama no es válida');
  return epochMs + frameIndex * FRAME_MS;
}

function alignDown(epochMs, timeMs) {
  return epochMs + Math.floor((timeMs - epochMs) / FRAME_MS) * FRAME_MS;
}

function estimateSenderNow(localSendMs, localRecvMs, senderSentMs) {
  const rttMs = localRecvMs - localSendMs;
  if (!Number.isFinite(rttMs) || rttMs < 0) throw new RangeError('El RTT no es válido');
  return senderSentMs + rttMs / 2;
}

function lateJoinPlayhead(epochMs, estimatedNowMs) {
  return alignDown(epochMs, estimatedNowMs - TARGET_BUFFER_MS);
}

function createSession(epochMs) {
  return {
    epochMs,
    playheadMs: null,
    stretch: 0,
    errorSinceMs: null,
    missingRun: 0,
    lastArrivedFrame: null,
    concealed: 0,
    gaps: 0,
    discontinuities: 0,
    jumps: 0,
    maxAbsStretch: 0,
  };
}

function setStretch(session, value) {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_STRETCH + 1e-12) {
    const error = new Error('La corrección supera el 0,2 %');
    error.code = 'stretch-limit';
    throw error;
  }
  session.stretch = value;
  session.maxAbsStretch = Math.max(session.maxAbsStretch, Math.abs(value));
}

function join(session, estimatedNowMs) {
  session.playheadMs = lateJoinPlayhead(session.epochMs, estimatedNowMs);
  session.lastArrivedFrame = Math.round((session.playheadMs - session.epochMs) / FRAME_MS);
  return session.playheadMs;
}

function onPacket(session, frameIndex, senderMs, localAdvanceMs) {
  const missing = session.missingRun;
  const holeMs = missing * FRAME_MS;
  session.missingRun = 0;
  if (holeMs > RESET_GAP_MS) {
    session.discontinuities += 1;
    session.playheadMs = alignDown(session.epochMs, senderMs - TARGET_BUFFER_MS);
    session.errorSinceMs = null;
    setStretch(session, 0);
    session.lastArrivedFrame = frameIndex;
    return;
  }
  if (missing === 1) session.concealed += 1;
  else if (missing === 2) session.concealed += 2;
  else if (missing >= 3) session.gaps += 1;
  const before = session.playheadMs;
  const consumed = localAdvanceMs * (1 + session.stretch);
  session.playheadMs = before + consumed;
  if (Math.abs(session.playheadMs - before - consumed) > 0.001) session.jumps += 1;
  const error = session.playheadMs - (senderMs - TARGET_BUFFER_MS);
  if (Math.abs(error) > ERROR_THRESHOLD_MS) {
    if (session.errorSinceMs == null) session.errorSinceMs = senderMs;
    if (senderMs - session.errorSinceMs >= ERROR_HOLD_MS) {
      setStretch(session, error > 0 ? -MAX_STRETCH : MAX_STRETCH);
    }
  } else if (session.stretch !== 0 && Math.abs(error) <= ERROR_THRESHOLD_MS) {
    session.errorSinceMs = null;
    setStretch(session, 0);
  } else {
    session.errorSinceMs = null;
  }
  session.lastArrivedFrame = frameIndex;
}

function observe(session, frameIndex, senderMs) {
  session.missingRun += 1;
  if (session.lastArrivedFrame != null && (frameIndex - session.lastArrivedFrame - 1) * FRAME_MS > RESET_GAP_MS) {
    session.discontinuities += 1;
    session.playheadMs = alignDown(session.epochMs, senderMs - TARGET_BUFFER_MS);
    session.errorSinceMs = null;
    setStretch(session, 0);
    session.missingRun = 0;
    session.lastArrivedFrame = frameIndex;
  }
}

function step(session, frameIndex, senderMs, localAdvanceMs, arrived) {
  if (session.playheadMs == null) throw new Error('El oyente no se ha unido');
  if (arrived) onPacket(session, frameIndex, senderMs, localAdvanceMs);
  else observe(session, frameIndex, senderMs);
  return session.playheadMs;
}

function percentile(values, fraction) {
  if (!values.length || fraction <= 0 || fraction > 1) throw new RangeError('El percentil no es válido');
  const sorted = values.map(value => Math.abs(value)).sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

function simulate(options) {
  const epochMs = options.epochMs ?? 0;
  const drift = options.drift ?? 1;
  const durationMs = options.durationMs;
  const joinAt = options.joinAtSenderMs ?? epochMs + TARGET_BUFFER_MS;
  const rttMs = options.rttMs ?? 0;
  const drop = options.drop || (() => false);
  if (!Number.isFinite(durationMs) || durationMs < FRAME_MS) throw new RangeError('La duración no es válida');
  const session = createSession(epochMs);
  const playhead = join(session, estimateSenderNow(0, rttMs, joinAt));
  const errors = [];
  let senderMs = joinAt;
  const end = joinAt + durationMs;
  while (senderMs + FRAME_MS <= end) {
    const next = senderMs + FRAME_MS;
    const frameIndex = Math.round((next - epochMs) / FRAME_MS);
    step(session, frameIndex, next, FRAME_MS * drift, !drop(frameIndex));
    errors.push(session.playheadMs - (next - TARGET_BUFFER_MS));
    senderMs = next;
  }
  return {session, errors, joinedAtMs: playhead};
}

function compare(left, right) {
  const durationMs = left.durationMs;
  const joinAt = left.joinAtSenderMs ?? right.joinAtSenderMs ?? TARGET_BUFFER_MS;
  const epochMs = left.epochMs ?? right.epochMs ?? 0;
  const frames = Math.floor(durationMs / FRAME_MS);
  const a = createSession(epochMs);
  const b = createSession(epochMs);
  join(a, estimateSenderNow(0, left.rttMs ?? 0, joinAt));
  join(b, estimateSenderNow(0, right.rttMs ?? 0, joinAt));
  const skew = [];
  for (let stepIndex = 1; stepIndex <= frames; stepIndex += 1) {
    const senderMs = joinAt + stepIndex * FRAME_MS;
    const frameIndex = Math.round((senderMs - epochMs) / FRAME_MS);
    const drop = left.drop || right.drop || (() => false);
    step(a, frameIndex, senderMs, FRAME_MS * (left.drift ?? 1), !drop(frameIndex));
    step(b, frameIndex, senderMs, FRAME_MS * (right.drift ?? 1), !drop(frameIndex));
    skew.push(a.playheadMs - b.playheadMs);
  }
  return {a, b, skew, p95Ms: percentile(skew, 0.95), p99Ms: percentile(skew, 0.99)};
}

module.exports = {
  FRAME_MS,
  TARGET_BUFFER_MS,
  MAX_STRETCH,
  ERROR_THRESHOLD_MS,
  ERROR_HOLD_MS,
  RESET_GAP_MS,
  mediaTime,
  alignDown,
  estimateSenderNow,
  lateJoinPlayhead,
  createSession,
  setStretch,
  join,
  step,
  percentile,
  simulate,
  compare,
};
