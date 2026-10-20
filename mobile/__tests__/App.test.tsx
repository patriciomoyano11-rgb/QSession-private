/**
 * @format
 */

import React from 'react';
import {Linking} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

jest.setTimeout(20_000);

jest.mock('@livekit/react-native-webrtc', () => ({
  MediaStream: class {
    addTrack() {}
    getTracks() { return []; }
  },
  RTCIceCandidate: jest.fn(),
  RTCPeerConnection: jest.fn(),
  RTCSessionDescription: jest.fn(),
}));
jest.mock('@livekit/react-native', () => ({
  AudioSession: {
    setDefaultRemoteAudioTrackVolume: jest.fn(),
    startAudioSession: jest.fn().mockResolvedValue(undefined),
    stopAudioSession: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('livekit-client', () => ({
  Room: jest.fn(),
  RoomEvent: {},
  Track: {Kind: {Audio: 'audio'}},
}));

import App from '../App';

beforeEach(() => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ok: true, rooms: []}),
  }) as jest.Mock;
});

test('renders correctly', async () => {
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  jest.spyOn(Linking, 'addEventListener').mockReturnValue({
    remove: jest.fn(),
  } as any);

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });

  ReactTestRenderer.act(() => renderer.unmount());
});

test('abre el editor de perfil desde la portada', async () => {
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  jest.spyOn(Linking, 'addEventListener').mockReturnValue({
    remove: jest.fn(),
  } as any);

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });

  ReactTestRenderer.act(() => {
    renderer.root.findByProps({accessibilityLabel: 'Crear o editar mi perfil'}).props.onPress();
  });
  expect(renderer.root.findByProps({accessibilityLabel: 'Nombre o apodo'})).toBeTruthy();
  expect(renderer.root.findByProps({accessibilityLabel: 'Guardar mi perfil'})).toBeTruthy();
  ReactTestRenderer.act(() => renderer.unmount());
});

test('la portada conserva las acciones principales del diseño web', async () => {
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  jest.spyOn(Linking, 'addEventListener').mockReturnValue({
    remove: jest.fn(),
  } as any);

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });

  expect(
    renderer.root.findByProps({accessibilityLabel: 'Entrar a una sala'}),
  ).toBeTruthy();

  ReactTestRenderer.act(() => {
    renderer.root.findByProps({accessibilityLabel: 'Crear una sala'}).props.onPress();
  });
  expect(
    renderer.root.findByProps({accessibilityLabel: 'Transmitir como DJ'}),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({accessibilityLabel: 'Organizar un evento'}),
  ).toBeTruthy();

  ReactTestRenderer.act(() => renderer.unmount());
});

test('la navegación móvil mantiene En vivo, Personas, Chat y Global', async () => {
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  jest.spyOn(Linking, 'addEventListener').mockReturnValue({
    remove: jest.fn(),
  } as any);

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });

  ReactTestRenderer.act(() => {
    renderer.root.findByProps({accessibilityLabel: 'Abrir Personas'}).props.onPress();
  });
  expect(
    renderer.root.findByProps({
      accessibilityLabel: 'Entrar a una sala para ver personas',
    }),
  ).toBeTruthy();

  ReactTestRenderer.act(() => {
    renderer.root.findByProps({accessibilityLabel: 'Abrir Chat'}).props.onPress();
  });
  expect(
    renderer.root.findByProps({
      accessibilityLabel: 'Crear identidad para usar el chat',
    }),
  ).toBeTruthy();
  expect(renderer.root.findAllByProps({
    children: 'Mientras estés conectado, aquí se abrirá únicamente el chat público de tu sala. Tus conversaciones privadas seguirán guardadas aparte.',
  })).toHaveLength(0);

  ReactTestRenderer.act(() => {
    renderer.root.findByProps({accessibilityLabel: 'Abrir Global'}).props.onPress();
  });
  expect(
    renderer.root.findAllByProps({children: 'personas ahora'}).length,
  ).toBeGreaterThan(0);
  expect(
    renderer.root.findByProps({
      accessibilityLabel: 'Planisferio político interactivo de Rave global',
    }),
  ).toBeTruthy();
  expect(renderer.root.findByProps({accessibilityLabel: 'Acercar mapa'})).toBeTruthy();

  ReactTestRenderer.act(() => renderer.unmount());
});
