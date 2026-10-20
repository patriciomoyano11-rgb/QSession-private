# Contrato compartido de Q Session

Base de producción: `https://qsession.org`

## Crear una sala

`POST /api/rooms`

Web, Windows, macOS, Android e iOS envían el mismo documento: nombre, anfitrión, tipo,
visibilidad y los interruptores funcionales de la sala. La respuesta contiene
el código público, el enlace y un `hostToken`. Este último nunca se muestra ni
se escribe en logs.

## Publicar

`POST /api/rooms/{CODE}/media-token`

```json
{"role":"dj","hostToken":"<control cifrado localmente>"}
```

El servidor devuelve una URL de LiveKit y una credencial multimedia efímera.
Al reconectar se solicita siempre una credencial nueva.

## Distribuir a la audiencia

`POST /api/rooms/{CODE}/broadcast/start`

```json
{"hostToken":"<control cifrado localmente>"}
```

Después de publicar el audio, el anfitrión solicita una sola mezcla HLS para la
audiencia. La operación es idempotente: Windows, macOS, Android o web pueden
repetirla al recuperar una sesión sin crear una segunda salida ni un segundo cobro.
Si el borde no está configurado, LiveKit continúa como ruta compatible.

## Finalizar

`POST /api/rooms/{CODE}/end`

Finalizar archiva la sala y limpia el control local. Cerrar inesperadamente la
aplicación no finaliza la sala: al abrirla de nuevo el anfitrión decide si desea
recuperarla o archivarla.

## Estados comunes

`preparing -> connecting -> live -> reconnecting -> live -> ending -> ended`

Los tokens nunca forman parte del estado visible. Windows protege el control
con DPAPI y macOS lo guarda en Keychain. Los adaptadores móviles deben usar
Android Keystore y iOS Keychain antes de habilitar recuperación persistente.
