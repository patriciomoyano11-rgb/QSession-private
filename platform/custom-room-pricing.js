'use strict';

function integer(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function flag(value) {
  return value === true;
}

function quoteCapacity(value) {
  const parsed = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))
    ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50_000) {
    throw new Error('Escribe un aforo entero entre 1 y 50.000 personas');
  }
  return parsed;
}

function audiencePrice(capacity) {
  const tiers = [
    [25, 12_000],
    [100, 27_000],
    [250, 53_400],
    [500, 159_000],
    [1000, 289_000],
    [5000, 999_000],
  ];
  if (capacity <= tiers[0][0]) return tiers[0][1];
  for (let index = 1; index < tiers.length; index += 1) {
    const [currentCapacity, currentPrice] = tiers[index];
    const [previousCapacity, previousPrice] = tiers[index - 1];
    if (capacity <= currentCapacity) {
      const progress = (capacity - previousCapacity) / (currentCapacity - previousCapacity);
      return previousPrice + (currentPrice - previousPrice) * progress;
    }
  }
  const [previousCapacity, previousPrice] = tiers.at(-2);
  const [lastCapacity, lastPrice] = tiers.at(-1);
  return lastPrice + (capacity - lastCapacity) * (lastPrice - previousPrice) / (lastCapacity - previousCapacity);
}

function calculateCustomRoomQuote(input = {}) {
  const capacity = quoteCapacity(input.capacity);
  const requiresReview = capacity > 5000;
  const durationMinutes = integer(input.durationMinutes, 60, 360, 120);
  const sessions = integer(input.sessions, 1, 30, 1);
  const translationLanguages = requiresReview ? 0 : integer(input.translationLanguages, 1, 3, 1);
  const features = {
    hostVideo: true,
    hostAudio: true,
    publicChat: !requiresReview && input.publicChat !== false,
    guestCameras: !requiresReview && flag(input.guestCameras),
    participantAudio: !requiresReview && flag(input.participantAudio),
    videoUploads: !requiresReview && flag(input.videoUploads),
    recording: !requiresReview && flag(input.recording),
    aiCameraEffects: !requiresReview && flag(input.aiCameraEffects),
    vjVisuals: !requiresReview && flag(input.vjVisuals),
    dedicatedSupport: flag(input.dedicatedSupport),
    translationLanguages,
  };

  const durationMultiplier = Math.min(2, 0.65 + 0.35 * (durationMinutes / 120));
  const featureMultiplier = 1
    + (features.guestCameras ? 0.35 : 0)
    + (features.participantAudio ? 0.15 : 0)
    + (features.videoUploads ? 0.10 : 0)
    + (features.recording ? 0.20 : 0)
    + (features.aiCameraEffects ? 0.08 : 0)
    + (features.vjVisuals ? 0.08 : 0)
    + Math.max(0, translationLanguages - 1) * 0.08;
  const sessionDiscount = sessions >= 10 ? 0.25 : sessions >= 5 ? 0.18 : sessions >= 2 ? 0.10 : 0;
  const basePerSession = audiencePrice(capacity) * durationMultiplier * featureMultiplier;
  const supportPesos = features.dedicatedSupport ? 45_000 : 0;
  const totalPesos = Math.max(20_000, Math.ceil(((basePerSession * sessions * (1 - sessionDiscount)) + supportPesos) / 1000) * 1000);
  const priceCents = totalPesos * 100;

  return {
    capacity,
    requiresReview,
    priceStatus: requiresReview ? 'estimate' : 'quoted',
    deliveryMode: requiresReview ? 'dj-broadcast' : 'interactive',
    capacityValidated: false,
    durationMinutes,
    sessions,
    translationLanguages,
    features,
    priceCents,
    currency: 'COP',
    pricePerSessionCents: Math.round(priceCents / sessions),
    discountPercent: Math.round(sessionDiscount * 100),
    lineItems: [
      {label: `Audiencia de hasta ${capacity.toLocaleString('es-CO')} personas`, included: true},
      {label: `${durationMinutes} minutos por sala`, included: true},
      {label: `${sessions} ${sessions === 1 ? 'sala' : 'salas'}`, included: true},
      ...(features.guestCameras ? [{label: 'Cámaras de participantes', included: true}] : []),
      ...(features.participantAudio ? [{label: 'Micrófonos de participantes', included: true}] : []),
      ...(features.videoUploads ? [{label: 'Videos enviados por usuarios', included: true}] : []),
      ...(features.recording ? [{label: 'Grabación de la sesión', included: true}] : []),
      ...(translationLanguages ? [{label: `Traducción a ${translationLanguages} ${translationLanguages === 1 ? 'idioma' : 'idiomas'}`, included: true}] : []),
      ...(features.aiCameraEffects ? [{label: 'Filtros y disfraces con IA', included: true}] : []),
      ...(features.vjVisuals ? [{label: 'Visuales VJ', included: true}] : []),
      ...(features.dedicatedSupport ? [{label: 'Acompañamiento prioritario', included: true}] : []),
      ...(sessionDiscount ? [{label: `${Math.round(sessionDiscount * 100)}% de descuento por volumen`, included: true}] : []),
    ],
  };
}

module.exports = {calculateCustomRoomQuote};
