/**
 * @format
 */

// Keep these requires sequential. Hermes must receive the WeakRef fallback
// before LiveKit (directly or through App) is evaluated.
require('./src/runtimePolyfills');

const { AppRegistry } = require('react-native');
const { registerGlobals } = require('@livekit/react-native');

registerGlobals();

const App = require('./App').default;
const { QSessionAudioEngine } = require('./src/QSessionAudioEngine');
const { startQSessionAudioHeadlessTask } = require('./src/QSessionAudioHeadlessTask');
const { name: appName } = require('./app.json');

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerComponent('QSessionAudioEngine', () => QSessionAudioEngine);
AppRegistry.registerHeadlessTask(
  'QSessionAudioPlayback',
  () => startQSessionAudioHeadlessTask,
);
