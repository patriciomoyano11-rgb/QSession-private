# Arquitectura evolutiva de Q Session

## Una plataforma, tres superficies

El núcleo web adaptable contiene navegación, cuenta, perfil, salas, comunidad y
chat. Android y Windows empaquetarán el mismo núcleo y expondrán capacidades nativas
mediante un contrato pequeño:

- Android: audio en segundo plano, cámara, selector de salida y notificaciones.
- Windows: captura WASAPI, cámara/capturadora y controles de transmisión.
- Web: cámara, micrófono, audio de pestaña y modo instalable PWA.

Los puentes no duplican pantallas ni reglas de negocio.

## Acceso global

Los clientes sólo conocen `https://qsession.org`. La API devuelve una descripción
de entrega multimedia; nunca construye direcciones LAN ni presupone que DJ y oyente
comparten router. Audio y video usan WSS/HTTPS y TURN público para redes restrictivas.

## Crecimiento por capas

1. **Control sin estado.** Varias instancias de la API pueden atender el mismo
   dominio detrás de un balanceador. Los tokens de control y de medios están
   firmados y no dependen de la memoria de una sola instancia.
2. **Datos durables.** PostgreSQL almacena cuentas, perfiles, salas y conversaciones.
   Las fotos y notas de voz viven en almacenamiento de objetos compatible con S3;
   la base sólo guarda metadatos y permisos.
3. **Estado efímero.** Redis conserva presencia, límites de solicitudes y ubicación
   consentida de corta duración para Rave global. No se usa la ciudad escrita como
   prueba de presencia real.
4. **Interacción.** Un clúster SFU regional conecta al DJ, cámaras sociales y grupos
   donde la latencia de conversación importa.
5. **Audiencia masiva.** LiveKit Egress mezcla la sala una sola vez a 720p/H.264 y
   AAC. Produce HLS de cuatro segundos en Cloudflare R2 y el borde distribuye la señal.
   Las cámaras y chats continúan en grupos particionados; no se intenta colocar un
   millón de conexiones en un solo proceso ni en una sola sala SFU.

El contrato `/api/rooms/:code/media-token` devuelve un objeto `delivery`: `broadcast`
cuando R2 está configurado, con una ruta firmada no adivinable y un respaldo
`webrtc`; de lo contrario devuelve `webrtc`. Web, Android y la interfaz Windows
reproducen HLS con recuperación y vuelven a WebRTC automáticamente si la entrega
de borde falla. Android mantiene sólo señalización ligera y suscribe cámaras
sociales bajo demanda cuando la persona abre la sección Personas.

## Primera meta operativa: 5.000 personas

La primera etapa masiva se dimensiona para 5.000 conexiones por sala y aplica estas
reglas desde el contrato, aunque la activación pública exige una prueba de carga:

- El DJ puede conectar hasta tres cámaras. Las cámaras se mezclan en origen y la
  audiencia recibe un único programa audiovisual; nunca tres pistas por persona.
- DJ, colaboradores invitados y llamadas privadas permanecen en LiveKit/WebRTC.
- La audiencia masiva recibe el programa por Cloudflare cuando se configuran
  `QSESSION_R2_*` y `QSESSION_EDGE_PLAYBACK_BASE_URL`. Una plantilla HLS externa
  sigue disponible como respaldo mediante `QSESSION_BROADCAST_PLAYBACK_URL_TEMPLATE`.
- El chat público se publica por WebSocket. Redis replica cada evento entre
  instancias y PostgreSQL conserva el historial; la consulta HTTP queda únicamente
  como carga inicial y recuperación.
- Web y Android mantienen un sondeo de respaldo de 15 segundos sólo mientras el
  WebSocket no está conectado. La beta anterior consultaba cada 2,5–4 segundos.
- Los videos utilizan URLs directas de un solo uso. El binario viaja del dispositivo
  al proveedor multimedia y no ocupa memoria, disco ni salida del proceso Node.
- El objetivo inicial del balanceador es 6.000 WebSockets para dejar 20 % de margen.

El modo compatible de archivo sigue disponible para desarrollo. En producción,
`QSESSION_DATABASE_URL` y `QSESSION_REDIS_URL` son obligatorios antes de anunciar
la capacidad de 5.000 personas.

## Salida audiovisual económica

El anfitrión inicia `/api/rooms/:code/broadcast/start` después de publicar su audio.
La operación es idempotente: antes de crear una mezcla consulta el egress activo de
`qsession-CODE`, evitando cobros dobles por recargas o dos ventanas del DJ. Al cerrar
o eliminar una sesión, Q Session detiene todos sus egress activos antes de archivar.
Además, Egress impone un máximo de seis horas a cualquier salida segmentada para
evitar una mezcla huérfana cobrando indefinidamente si un cliente desaparece.

R2 recibe `live/CODE-FIRMA/index.m3u8` y sus segmentos. La firma deriva de un secreto
del servidor y no aparece en el directorio público. `edge/hls-worker.js` sólo entrega
rutas con ese formato, aplica CORS para Q Session y evita guardar playlists en caché.
El bucket debe borrar automáticamente el prefijo `live/` después de 24 horas.

El mezclador de sala necesita aproximadamente 3 CPU por composición; no debe
prometerse una sesión de 5.000 personas en el VPS actual sin una máquina de al menos
4 vCPU para Egress o un nodo Egress separado. El número de espectadores aumenta las
lecturas del borde, no la cantidad de mezclas ni la salida del VPS.

### Regla de costos del borde

- Producción usa `cloudflare-r2-hls`: Egress escribe una sola copia de cada segmento
  directamente en el bucket privado y nunca una copia por espectador.
- El Worker cachea playlists durante dos segundos y segmentos inmutables durante 24
  horas, de modo que las personas de una misma región no repitan lecturas de R2.
- Los segmentos duran seis segundos. Esto reduce aproximadamente 33 % las
  solicitudes respecto de la beta de cuatro segundos, con una latencia objetivo de
  unos 18 segundos para la audiencia masiva.
- El perfil inicial es 720p H.264 a 1,6 Mbps y AAC a 128 kbps: cerca de 0,78 GB por
  espectador-hora, sin cargo de egreso de R2 pero útil para estimar consumo móvil.
- `local-origin-hls-fallback` es sólo una ruta de emergencia. El panel y
  `/api/status` deben alertar si producción permanece en ese modo.
- El prefijo `live/` se elimina después de 24 horas. Q Session no conserva una
  grabación por accidente ni paga almacenamiento indefinido.

## Regla de producción

El almacenamiento JSON incluido sirve únicamente para desarrollo y compatibilidad
durante la migración. El chat público ya dispone de adaptador PostgreSQL y el canal
en vivo puede distribuirse con Redis. El esquema se aplica en orden desde `db/` al
iniciar el contenedor. Las cuentas y demás datos de la beta continuarán migrándose
por dominio sin interrumpir sesiones activas.
