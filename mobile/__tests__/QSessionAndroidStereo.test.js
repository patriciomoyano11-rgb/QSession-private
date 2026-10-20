const fs = require('node:fs');
const path = require('node:path');

describe('Q Session Android music playback', () => {
  test('uses the Q Session WebRTC playout path', () => {
    const workspaceConfig = fs.readFileSync(
      path.join(__dirname, '..', 'pnpm-workspace.yaml'),
      'utf8',
    );
    const liveKitNative = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        'node_modules',
        '@livekit',
        'react-native',
        'android',
        'src',
        'main',
        'java',
        'com',
        'livekit',
        'reactnative',
        'LiveKitReactNative.kt',
      ),
      'utf8',
    );

    expect(workspaceConfig).not.toContain('patchedDependencies');
    expect(liveKitNative).not.toContain('.setUseStereoOutput(true)');
  });
});
