import {loadModel} from './model.mjs';
const model=await loadModel(true);
await model.dispose();
console.log('Modelo CLAP preparado para análisis local sin conexión.');
