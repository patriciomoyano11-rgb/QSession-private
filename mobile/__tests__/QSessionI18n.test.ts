import {qsessionTranslate} from '../src/QSessionI18n';

describe('QSession internationalization', () => {
  test('keeps the Spanish source copy in Spanish', () => {
    expect(qsessionTranslate('Entrar a una sala', 'es')).toBe('Entrar a una sala');
  });

  test('translates interface copy and live values into English', () => {
    expect(qsessionTranslate('Entrar a una sala', 'en')).toBe('Join a room');
    expect(qsessionTranslate('5 oyentes conectados', 'en')).toBe('5 listeners connected');
    expect(qsessionTranslate('Buscando la sala PARTY1 en QSession…', 'en')).toBe(
      'Looking for room PARTY1 on QSession…',
    );
    expect(qsessionTranslate('Personas', 'en')).toBe('People');
    expect(qsessionTranslate('Posibles conexiones', 'en')).toBe('Potential connections');
    expect(qsessionTranslate('Iniciar sesión', 'en')).toBe('Sign in');
    expect(qsessionTranslate('Mi Story', 'en')).toBe('My Story');
    expect(qsessionTranslate('Pantalla completa', 'en')).toBe('Full screen');
    expect(qsessionTranslate('Salir de pantalla completa', 'en')).toBe('Exit full screen');
  });

  test('translates dynamic account, camera, chat and connection states', () => {
    const values = [
      'Abriendo tus fotos…',
      'Esta sala todavía no tiene disponible el mosaico de cámaras.',
      'Grabando… toca el botón rojo para enviar. Máximo 30 segundos.',
      'No pudimos comprobar tu ubicación aproximada. Seguirás en la sala sin aparecer en el mapa.',
      'Tu perfil está privado o todavía no guardaste el cambio a Público.',
      'Conexión del DJ recuperada. Esperando audio…',
      'El chat en vivo necesita una sala con distribución QSession.',
      'Comprobando el transporte de la sala…',
    ];
    for (const value of values) expect(qsessionTranslate(value, 'en')).not.toBe(value);
  });
});
