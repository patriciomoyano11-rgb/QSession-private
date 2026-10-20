# Audio del DJ y video 720p para una audiencia objetivo de 500.000

Estado del 18 de octubre de 2026: implementado y probado localmente; no publicado, contratado ni validado con 500.000 espectadores reales. La opción nueva está desactivada por defecto. El objetivo de audiencia es una especificación, no una capacidad disponible. El usuario confirmó una sola transmisión para 500.000 espectadores simultáneos, con recepción sin cámaras, micrófonos ni chat público de oyentes. Solicitó expresamente mantenerla desactivada.

## Lo que había y lo que cambia

La consulta pública de producción indicó un objetivo configurado de 5000 participantes, un límite WebSocket de 6000 conexiones, Redis, chat PostgreSQL y HLS sobre Cloudflare R2. Los límites declarados tampoco son una prueba de carga. La ruta anterior mantenía a cada oyente conectado a LiveKit, aun usando HLS, y recurría a WebRTC al fallar la CDN.

Con QSESSION_AUDIENCE_MODE=cdn-only, una única sala indicada en QSESSION_CDN_ONLY_ROOM y un expediente vigente, la autorización del oyente entrega solamente la URL HLS. No emite token SFU, ticket de presencia ni permisos de cámara o micrófono, ni registra cada entrada mediante una escritura del estado general. El DJ conserva su conexión de publicación. Las rutas con contraseña y pago conservan sus controles de acceso. Las salas con aforo limitado o límite del plan se rechazan hasta disponer de un contador distribuido de admisiones CDN: el conteo de participantes LiveKit no mide espectadores CDN.

El reproductor web compartido por Android WebView y Windows inicia HLS sin conectar un participante LiveKit. Si falla la CDN, ofrece reintentar sin activar WebRTC ni el audio nativo directo. El modo no abre el chat de sala ni recompensas periódicas de escucha; pausa también los sondeos automáticos del directorio, mapa y actividad personal mientras se recibe ese evento. La consulta del país GPS deja de enviar pulsos durante esa recepción; no se borra el consentimiento ni se inventa otra ubicación. Al salir se recuperan los sondeos habituales. El perfil interactivo sigue siendo el predeterminado. Los clientes nativos antiguos que solicitan nativeAudio reciben un rechazo para evitar una reconexión masiva al SFU.

LiveKit Participant Egress selecciona la identidad del DJ principal y codifica H.264 a 1280×720, 30 fps y audio AAC a 48 kHz. Se corrigió una incompatibilidad de unidades: las variables de entorno usan bits/s y EncodingOptions requiere kbit/s. Por ejemplo, 1800000 y 320000 pasan al SDK como 1800 y 320. Esto no garantiza que una fuente de baja calidad mejore al recodificarla. Verificar específicamente el audio Windows de captura de pestaña, que puede proceder de un participante separado: no asumir que Participant Egress lo incluye sin una prueba real de cada fuente.

## Dimensión de la distribución

El perfil de ejemplo reserva 1.800.000 bit/s de video y 320.000 bit/s de audio: 2.120.000 bit/s por espectador. Para 500.000 simultáneos son 1,06 Tb/s y 477 TB decimales por hora de contenido. Con un margen de ingeniería del 20%, aproximadamente 1,272 Tb/s y 572,4 TB/h. Son cálculos de planificación, no medidas ni una cotización. La transcodificación VBR, el contenedor, TLS y patrones de reproducción modifican el tráfico real. Con segmentos de 6 segundos, los segmentos por sí solos implican unas 83.333 solicitudes/s en la CDN; las actualizaciones de manifiesto y reintentos se suman.

La salida del DJ se envía una vez al origen y la CDN replica al público. No se debe provisionar 1 Tb/s en la laptop del DJ. El único servidor actual no puede considerarse sustituto de la CDN ni de un plano de control dimensionado.

## Trabajo requerido antes de habilitar

1. Confirmar con el proveedor cobertura, capacidad de pico, cuotas, términos de distribución de video y presupuesto para esa audiencia. Tener R2 configurado no confirma por sí solo esos puntos.
2. Distribuir ingresos y autorizaciones entre réplicas sin estado detrás de balanceo, con caché o credenciales de reproducción verificables en el borde. Conservar acceso a salas privadas y entradas pagadas; la URL HLS actual no es por sí sola un sistema de acceso individual revocable.
3. Configurar caché diferenciada: manifiestos breves y segmentos inmutables; origin shield, CORS, TLS, vigilancia de antigüedad del manifiesto y protección frente a avalanchas de reconexión. Verificar toda la cadena almacenamiento → CDN → cliente.
4. Dimensionar transcodificación por DJ/sala, redundancia, base de datos y admisiones. Revisar escrituras y sondeos de perfiles, directorio, GPS y estadísticas del resto de la app. El modo HLS no convierte automáticamente esos servicios en servicios para 500.000 usuarios.
5. Probar las fuentes reales de audio y cámara de Windows/Android/web y el reproductor en primer plano, pantalla bloqueada y redes variables. Confirmar que no se mezclen voces de oyentes ni se pierda el audio del DJ.
6. Ejecutar rampas autorizadas de carga distribuida, con límites de coste y tráfico, y ensayos de caída del origen y CDN. Medir p95/p99 de ingreso, reproducción fallida, buffering, latencia, tráfico real y errores. Nunca usar una prueba de 500.000 bucles HTTP locales como certificación de audiencia.
7. Sólo después activar el perfil de ejemplo y declarar una capacidad según las mediciones y el contrato. No se ejecutaron pruebas masivas contra producción ni se modificó infraestructura en esta tarea.

## Validación local

38 pruebas aprobadas: 23 de plataforma, 6 de egress, 3 de comportamiento del cliente masivo y 6 de preparación/CLI. Comprueban el aislamiento del DJ, 720p/30, conversión de unidades, ausencia de credenciales SFU para oyentes, mantenimiento del permiso de publicación del DJ, bloqueo de clientes que piden audio directo y ausencia de fallback ante fallo CDN. No prueban calidad perceptiva, reproducción física en tres plataformas ni concurrencia real de 500.000 personas.

Referencias técnicas: [Egress y unidades de codificación de LiveKit](https://docs.livekit.io/reference/other/egress/api/), [salidas HLS](https://docs.livekit.io/transport/media/ingress-egress/egress/outputs/). La documentación de proveedores describe servicios; no certifica la capacidad de esta instalación.

## Paquete de preparación, sin activación

`deploy/mass-broadcast.env.example` queda en `interactive`, con sala vacía. No se ha aplicado al entorno en producción. `deploy/mass-broadcast-readiness.example.json` contiene únicamente pendientes: nunca es una aprobación válida. El overlay `deploy/compose.mass-broadcast.yml` monta un expediente de operador en modo de sólo lectura; por sí solo no cambia el modo.

El comando siguiente lee archivos, informa bloqueos y termina. No modifica variables, contrata servicios, publica archivos ni envía tráfico de carga:

```sh
cd platform
node scripts/check-mass-broadcast.cjs --env-file deploy/mass-broadcast.env.example --readiness-file deploy/mass-broadcast-readiness.example.json
```

La salida esperada ahora es código 1 y `willActivate:false`. Códigos: 0 significa que el expediente está completo según los campos y fechas; 1 significa pendientes; 2 significa entrada ilegible o inválida. **No** certifica la veracidad de las evidencias ni reproduce una prueba de 500.000 espectadores. Los expedientes completos usados en pruebas automatizadas están expresamente marcados como sintéticos y no se deben copiar a producción.

Para una futura activación harán falta las referencias de proveedor, presupuesto, caché y origen, privacidad/acceso, admisiones distribuidas, carga y reconexión, redundancia, pruebas audiovisuales Windows/Android/web, alertas y ensayo de reversión. Registrar responsable y fechas reales: una revisión caduca en un máximo de 30 días. Debe coincidir la sala, audiencia y perfil de codificación; la prueba de ingreso debe cubrir la audiencia en una ventana declarada de 30 a 300 segundos. Un expediente sin esas evidencias bloquea el arranque en `cdn-only`.

La app lee el expediente al iniciar desde `QSESSION_MASS_BROADCAST_READINESS_FILE`. No lo consulta por espectador ni añade lecturas del disco al tráfico masivo. Si caduca después de arrancar, bloquea nuevas admisiones a esa sala sin ofrecer credenciales WebRTC. Esto no revoca URLs HLS ya emitidas: esa función corresponde al control de acceso de la CDN y debe estar cubierta por la revisión de privacidad.

## Procedimiento futuro de activación — no ejecutado

1. Preparar y probar un entorno separado con la misma versión de app, codificador, CDN y almacenamiento; contratar los recursos y aprobar el presupuesto. No basta con cambiar el número objetivo.
2. Crear la sala del evento y registrar su código exacto. Mantener las otras salas en el flujo habitual. Las salas con aforo o límite de plan se bloquean hasta disponer de admisiones CDN compatibles; no se debe quitar un límite contratado para eludir el bloqueo.
3. Revisar específicamente el transporte del audio del DJ de cada fuente. Si la captura Windows utiliza otro participante, corregir y probar la composición antes de aprobar `windowsAudioVideo`. La herramienta no hace esa composición por sí misma.
4. Copiar y completar el expediente real en `deploy/private/mass-broadcast-readiness.json`. No marcar un control como aprobado sin su referencia comprobable y fecha. No guardar credenciales, tokens de invitados ni coordenadas en el expediente.
5. Preparar una copia de `qsession.env` que conserve todos los ajustes y secretos actuales. Incluir el código seleccionado, el perfil probado, la ruta de expediente y **sólo cuando se autorice activar**, `QSESSION_AUDIENCE_MODE=cdn-only`. Mantener `QSESSION_CDN_ONLY_PAUSED=false` al abrir el ingreso. No reemplazar el archivo completo con el ejemplo.
6. Ejecutar preflight contra esa copia y el expediente. Registrar la versión exacta de código e imágenes, resultado, métricas de carga, validación de contenido y aprobación del operador. Si termina distinto de cero, detener el procedimiento antes de reemplazar el servicio.
7. Respaldar la configuración y la imagen actuales. Integrar el overlay de expediente con los archivos Compose que realmente use ese entorno; comprobar con `docker compose ... config --quiet` que la ruta montada es un archivo legible para el usuario `node`. El overlay no sustituye al resto de la configuración real del servidor.
8. En el despliegue aprobado, reconstruir y reemplazar **únicamente** `qsession-app` con `--no-deps`. No reiniciar LiveKit, Egress, TURN, Redis, PostgreSQL ni el almacenamiento de segmentos por aplicar este perfil. Cambiar versiones de frontend y service worker para evitar clientes con la lógica anterior de fallback.
9. Comprobar por etapas: DJ único → egress activo → manifiesto fresco → audio/video real en CDN → tres clientes → rampa autorizada. Verificar que el oyente de la sala elegida recibe `transport:hls`, `permissions:[listen]`, ningún token SFU y `fallback:null`; comprobar que las otras salas conservan el modo anterior. Validar métricas de la CDN, no el número de participantes de LiveKit, para medir audiencia.

No se incluyó un botón que ejecute todo el proceso ni un script que compre capacidad. El expediente habilita una revisión controlada, no una reserva de infraestructura.

## Pausa y reversión seguras

`QSESSION_CDN_ONLY_PAUSED=true` detiene nuevas admisiones a la sala masiva con respuesta 503 y `Retry-After:30`, sin retornar tokens SFU. Requiere aplicar la configuración mediante el procedimiento del despliegue; las sesiones HLS existentes y el publicador LiveKit no se cierran por ese rechazo.

**No cambiar el evento a `interactive` mientras cientos de miles de oyentes intentan reconectar**: podría llevarlos al servidor de medios. Ante una incidencia, pausar admisiones, mantener el suministro CDN existente si funciona, investigar y usar una imagen previamente ensayada que también respete el modo exclusivo HLS. Reabrir gradualmente tras validar recuperación y presupuesto. La reversión a una versión antigua que sólo conoce WebRTC es admisible únicamente con el evento ya cerrado y los clientes retirados; la imagen previa por sí sola no es un plan de continuidad masiva.

Cerrar el evento con sus controles de anfitrión detiene la emisión según el flujo existente. Verificar la retirada de nuevos accesos y el final de la playlist en la CDN, conservar registros sin datos sensibles y conciliar costes. Sólo después retirar el perfil de ese evento y volver al modo habitual.
