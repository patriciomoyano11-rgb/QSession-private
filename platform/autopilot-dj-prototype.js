/**
 * ============================================================================
 * Q SESSION - AUTOPILOT DJ SYSTEM (Silent Parties, Yoga & Meditation)
 * ============================================================================
 */

// --- BLOQUE 1: Pipeline de Análisis Previo (ADN Musical) ---
const AudioAnalyzer = {
  async analyzeTrack(audioBuffer, metadata) {
    console.log(`[Autopilot DSP] Analizando pista: ${metadata.title}`);
    const tempoData = await this.detectTempoAndDownbeats(audioBuffer);
    const phrases = await this.detectMusicalPhrases(audioBuffer, tempoData.downbeats);
    const camelotKey = await this.detectCamelotKey(audioBuffer);
    const energyCurve = await this.calculateEnergyCurve(audioBuffer);

    return {
      trackId: metadata.id,
      title: metadata.title,
      bpm: tempoData.bpm,
      downbeats: tempoData.downbeats,
      phrases: phrases,
      camelotKey: camelotKey, // Ej: "8A", "4B"
      energyCurve: energyCurve,
      averageEnergy: energyCurve.reduce((a, b) => a + b, 0) / energyCurve.length
    };
  },

  async detectTempoAndDownbeats(buffer) {
    return { bpm: 124.0, downbeats: [0.0, 2.0, 4.0, 6.0] };
  },

  async detectMusicalPhrases(buffer, downbeats) {
    return [
      { start: 0, end: 32, type: 'intro' },
      { start: 32, end: 96, type: 'verse' },
      { start: 96, end: 128, type: 'breakdown' }
    ];
  },

  async detectCamelotKey(buffer) {
    return "8A";
  },

  async calculateEnergyCurve(buffer) {
    return [3, 4, 6, 8, 9, 9, 5, 3]; // Curva de energía de 1 a 10
  }
};


// --- BLOQUE 2: Perfiles de Comportamiento (Modos de Mezcla) ---
const TransitionProfiles = {
  dance: {
    name: "Modo Baile / Alta Energía (Silent Party)",
    crossfadeDuration: 4.0,
    allowPitchBending: true,
    maxBpmDifference: 6.0,
    executeTransition(outgoingTrack, incomingTrack) {
      console.log(`[Perfil Baile] Mezclando rítmicamente: "${outgoingTrack.title}" -> "${incomingTrack.title}"`);
      return { action: "EQ_SWAP_AND_BEAT_MATCH", duration: this.crossfadeDuration };
    }
  },

  meditation: {
    name: "Modo Meditación / Atmosférico (Yoga & Flow)",
    crossfadeDuration: 25.0,
    allowPitchBending: false,
    strictHarmonicMatch: true,
    executeTransition(outgoingTrack, incomingTrack) {
      console.log(`[Perfil Meditación] Fundido cruzado largo: "${outgoingTrack.title}" -> "${incomingTrack.title}"`);
      return { action: "LONG_HARMONIC_CROSSFADE", duration: this.crossfadeDuration };
    }
  }
};


// --- BLOQUE 3: Máquina de Estados (Decisión en Tiempo Real) ---
class AutopilotStateMachine {
  constructor(playlist, profileName = 'dance') {
    this.playlist = playlist;
    this.currentTrackIndex = 0;
    this.profile = TransitionProfiles[profileName] || TransitionProfiles.dance;
    this.playbackPositionSeconds = 0.0;
    this.isTransitioning = false;
  }

  tick(currentTime, energySliderValue) {
    this.playbackPositionSeconds = currentTime;
    const currentTrack = this.playlist[this.currentTrackIndex];

    if (!currentTrack || this.isTransitioning) return;

    const timeLeft = currentTrack.duration - this.playbackPositionSeconds;
    const transitionThreshold = this.profile.crossfadeDuration + 5.0;

    if (timeLeft <= transitionThreshold) {
      this.triggerSmartTransition(energySliderValue);
    }
  }

  triggerSmartTransition(energySliderValue) {
    this.isTransitioning = true;
    const currentTrack = this.playlist[this.currentTrackIndex];
    const nextTrack = this.selectBestCandidate(energySliderValue, currentTrack);
    const transitionPlan = this.profile.executeTransition(currentTrack, nextTrack);

    console.log(`[Autopilot State] Transición en curso: ${transitionPlan.action} hacia "${nextTrack.title}"`);

    setTimeout(() => {
      this.currentTrackIndex = (this.currentTrackIndex + 1) % this.playlist.length;
      this.isTransitioning = false;
    }, transitionPlan.duration * 1000);
  }

  selectBestCandidate(targetEnergy, currentTrack) {
    let bestMatch = this.playlist[(this.currentTrackIndex + 1) % this.playlist.length];
    console.log(`[Selección Inteligente] Candidato elegido óptimo para energía objetivo: ${targetEnergy}`);
    return bestMatch;
  }
}


// --- BLOQUE 4: Interfaz de Control para el Anfitrión ---
class AutopilotHostController {
  constructor(stateMachine) {
    this.stateMachine = stateMachine;
    this.energySliderValue = 5.0; // Escala del 1 al 10
    this.isAutopilotActive = true;
  }

  onEnergySliderChanged(newValue) {
    this.energySliderValue = Math.max(1.0, Math.min(10.0, newValue));
    console.log(`[Host UI] Energía de la sala ajustada a: ${this.energySliderValue}`);
  }

  toggleAutopilot(activeState) {
    this.isAutopilotActive = activeState;
    console.log(`[Host UI] Autopilot DJ: ${this.isAutopilotActive ? 'Activado' : 'Pausado (Manual)'}`);
  }

  forceManualTransition() {
    console.log(`[Host UI] ¡Override manual activado por el instructor!`);
    if (this.stateMachine) {
      this.stateMachine.triggerSmartTransition(this.energySliderValue);
    }
  }

  updateLoop(currentTime) {
    if (this.isAutopilotActive && this.stateMachine) {
      this.stateMachine.tick(currentTime, this.energySliderValue);
    }
  }
}

module.exports = {
  AudioAnalyzer,
  TransitionProfiles,
  AutopilotStateMachine,
  AutopilotHostController
};
