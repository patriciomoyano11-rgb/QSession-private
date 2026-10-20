export type AudioEnergySnapshot = {
  totalAudioEnergy: number;
  totalSamplesDuration: number;
};

type AudioLevelMeasurement = {
  level: number | null;
  snapshot: AudioEnergySnapshot | null;
};

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function reportEntries(report: unknown): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  if (!report) return entries;
  if (Array.isArray(report)) return report.filter(item => item && typeof item === 'object');
  if (typeof (report as {forEach?: unknown}).forEach === 'function') {
    (report as {forEach: (callback: (value: Record<string, unknown>) => void) => void})
      .forEach(value => entries.push(value));
    return entries;
  }
  if (typeof report === 'object') {
    return Object.values(report).filter(item => item && typeof item === 'object') as Record<string, unknown>[];
  }
  return entries;
}

export function measureIncomingAudio(
  report: unknown,
  previous: AudioEnergySnapshot | null,
): AudioLevelMeasurement {
  const audioEntries = reportEntries(report).filter(stat => {
    const type = String(stat.type || '').toLowerCase();
    const kind = String(stat.kind || stat.mediaType || '').toLowerCase();
    return (type === 'inbound-rtp' || type === 'track' || type === 'media-source') && kind === 'audio';
  });

  let directLevel: number | null = null;
  let energySnapshot: AudioEnergySnapshot | null = null;
  for (const stat of audioEntries) {
    const audioLevel = finiteNumber(stat.audioLevel);
    if (audioLevel !== null && audioLevel >= 0) {
      directLevel = Math.max(directLevel || 0, audioLevel);
    }
    const totalAudioEnergy = finiteNumber(stat.totalAudioEnergy);
    const totalSamplesDuration = finiteNumber(stat.totalSamplesDuration);
    if (totalAudioEnergy !== null && totalSamplesDuration !== null) {
      energySnapshot = {totalAudioEnergy, totalSamplesDuration};
    }
  }

  let energyLevel: number | null = null;
  if (energySnapshot && previous) {
    const energyDelta = energySnapshot.totalAudioEnergy - previous.totalAudioEnergy;
    const durationDelta = energySnapshot.totalSamplesDuration - previous.totalSamplesDuration;
    if (energyDelta >= 0 && durationDelta > 0) {
      energyLevel = Math.sqrt(Math.max(0, energyDelta / durationDelta));
    }
  }

  const measured = Math.max(directLevel || 0, energyLevel || 0);
  return {
    level: directLevel === null && energyLevel === null ? null : Math.min(1, measured),
    snapshot: energySnapshot,
  };
}

export function visualAudioLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  // Audio levels are linear RMS values and normally remain below 0.25 for music.
  // A square-root curve keeps quiet passages visible without flattening peaks.
  return Math.min(1, Math.sqrt(level) * 1.55);
}
