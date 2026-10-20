import React, {useEffect, useRef} from 'react';
import {NativeEventEmitter, NativeModules} from 'react-native';
import {finishQSessionAudioHeadlessTask} from './QSessionAudioHeadlessTask';
import {QSessionNativeAudioClient} from './QSessionNativeAudioClient';
import {playback} from './platform/QSessionNativeModules';

type NativeAudioCommand = {
  type?: string;
  server?: string;
  roomCode?: string;
  accessToken?: string;
  muted?: boolean;
  gain?: number;
};

export function QSessionAudioEngine() {
  const bridge = NativeModules.QSessionWebAudio;
  const client = useRef(
    new QSessionNativeAudioClient(() => {
      bridge?.report?.(JSON.stringify({type: 'ready'}));
    }),
  ).current;

  useEffect(() => {
    if (!bridge) return () => undefined;
    const emitter = new NativeEventEmitter(bridge);
    const subscription = emitter.addListener(
      'QSessionNativeAudioCommand',
      (raw: string) => {
        let command: NativeAudioCommand;
        try {
          command = JSON.parse(raw || '{}');
        } catch {
          return;
        }
        if (command.type === 'listener-start') {
          void client.start(command).catch(error => {
            bridge.report?.(
              JSON.stringify({
                type: 'error',
                message:
                  error instanceof Error
                    ? error.message
                    : 'No fue posible activar el audio nativo.',
              }),
            );
          });
        } else if (command.type === 'listener-muted') {
          client.setMuted(Boolean(command.muted));
        } else if (command.type === 'listener-output-gain') {
          client.setOutputGain(Number(command.gain));
        } else if (command.type === 'listener-resume') {
          void client.resume().catch(() => undefined);
        } else if (command.type === 'listener-stop') {
          void client.stop().finally(finishQSessionAudioHeadlessTask);
        } else if (command.type === 'listener-runtime-stop') {
          void client.stop().finally(finishQSessionAudioHeadlessTask);
        } else if (command.type === 'broadcast-service-start') {
          void playback?.startBroadcast?.(String(command.roomCode || 'PREPARANDO'));
        } else if (command.type === 'broadcast-service-stop') {
          if (playback?.stopBroadcast) {
            void playback.stopBroadcast();
          } else {
            void playback?.stop();
          }
        }
      },
    );
    bridge.ready();
    return () => {
      subscription.remove();
      // The foreground headless task, not the Activity, owns the listener
      // lifetime. Unmounting a view must never terminate lock-screen audio.
    };
  }, [bridge, client]);

  return null;
}
