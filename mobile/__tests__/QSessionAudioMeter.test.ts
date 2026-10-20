import {measureIncomingAudio, visualAudioLevel} from '../src/QSessionAudioMeter';

test('lee el nivel instantáneo de una pista de audio entrante', () => {
  const report = new Map([
    ['audio', {type: 'inbound-rtp', kind: 'audio', audioLevel: 0.16}],
    ['video', {type: 'inbound-rtp', kind: 'video', audioLevel: 0.9}],
  ]);
  expect(measureIncomingAudio(report, null).level).toBe(0.16);
});

test('calcula RMS mediante la energía acumulada cuando no existe audioLevel', () => {
  const previous = {totalAudioEnergy: 3, totalSamplesDuration: 12};
  const report = [{
    type: 'inbound-rtp',
    mediaType: 'audio',
    totalAudioEnergy: 3.04,
    totalSamplesDuration: 13,
  }];
  expect(measureIncomingAudio(report, previous).level).toBeCloseTo(0.2, 5);
});

test('hace visibles los pasajes musicales suaves sin exceder el máximo', () => {
  expect(visualAudioLevel(0)).toBe(0);
  expect(visualAudioLevel(0.04)).toBeCloseTo(0.31, 2);
  expect(visualAudioLevel(1)).toBe(1);
});
