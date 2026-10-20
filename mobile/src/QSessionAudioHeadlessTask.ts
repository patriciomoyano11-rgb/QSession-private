/**
 * Keeps React Native's JavaScript runtime explicitly active while Android's
 * foreground listener service is running.
 *
 * The LiveKit transport and decoder are native, but their room lifecycle is
 * coordinated by JavaScript. A hidden React root alone is not enough on every
 * Android vendor: the runtime can be frozen a few minutes after screen-off.
 * Android starts this task with no timeout, the supported React Native pattern
 * for long-running music playback, and finishes it when the listener stops.
 */
let finishActiveTask: (() => void) | null = null;

export function startQSessionAudioHeadlessTask(): Promise<void> {
  finishActiveTask?.();
  return new Promise(resolve => {
    finishActiveTask = resolve;
  });
}

export function finishQSessionAudioHeadlessTask() {
  const finish = finishActiveTask;
  finishActiveTask = null;
  finish?.();
}
