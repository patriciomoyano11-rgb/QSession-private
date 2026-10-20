# Auto DJ y controles Android

La biblioteca compartida por Android WebView y web usa `public/dj-mixer.js`.
La página principal y administración cargan el motor antes de `music-library.js`;
el service worker incluye ambos y tiene una nueva versión de caché.

## Mezcla

- Dos elementos de audio con cadenas independientes: analizador, ajuste de
  nivel, ecualizador de graves y fader. Ambos llegan al volumen maestro y al
  compresor de protección; la transmisión recibe esta misma salida procesada.
- Precarga de la pista siguiente y escucha silenciosa durante 16 segundos para
  analizar ataques graves, tempo y fase sin descargar ni decodificar archivos
  completos adicionales en Android. El análisis conserva sólo 24 segundos de
  ataques y pequeñas matrices FFT, no el audio de la canción.
- Si las dos rejillas de pulso tienen confianza suficiente y la corrección de
  tempo está entre −8 % y +8 %, mezcla de 4, 8 o 16 compases con conservación de
  tono mediante `preservesPitch`. La detección usa tiempos de la propia pista.
- Entrada en el pulso siguiente, fundidos de potencia constante e intercambio
  de graves alrededor del centro. El ajuste de nivel reduce el deck más fuerte
  y reserva margen; el compresor protege la suma, sin prometer normalización LUFS.
- Las frases se alinean sólo cuando ambas pistas tienen puntos verificados.
  Cuando faltan pulsos fiables o los tempos son incompatibles, se usa una mezcla
  superpuesta breve sin sincronización ni modificación del tempo entrante.
- La selección respeta los filtros y la curva de energía, favorece BPM cercanos
  y tonalidades Camelot compatibles cuando se conocen. No deduce tonalidad a
  partir del género. Los datos se pueden corregir en Ajustar → Datos DJ verificados.
- Pausar, cambiar pista, buscar una posición o modificar la cola cancela el deck
  preparado y las automatizaciones pendientes. Un fallo de la pista entrante
  conserva la pista actual.

## Interfaz compartida

La biblioteca usa superficies claras, azul QSession y celestes luminosos, géneros en chips y dos
vistas: Biblioteca y Mis playlists. Las playlists tienen tarjetas con acciones
de escuchar o cargar al set. La cola permite subir y bajar pistas futuras, quitar
pistas y limpiar las próximas conservando la canción actual. Guardar como nueva
evita sustituir una playlist existente. Los ajustes Auto DJ están agrupados con
iconos y etiquetas. El reproductor permanece visible; en móvil, BPM, mezcla y
volumen se abren desde un panel compacto. Hay un solo desplazamiento principal
en móvil, con cabecera y reproductor fijos dentro del diálogo.

La consola del emisor mantiene visibles los nombres y estados de los controles.
En móvil coloca las acciones principales antes de la vista previa. La fuente y
calidad, voz adicional, cámara y configuración de sala están agrupadas. Android
no ofrece captación de pestaña cuando no puede usarla. Los controles de cámara
se limitan al formato en vivo; el formato grabado ofrece pausa y reinicio.

Cambiar la fuente comprueba permisos antes de retirar la señal actual. Si falla
la publicación, intenta restaurar el track anterior. Los recursos anteriores
se detienen después de publicar la nueva fuente. El cambio no detiene el video
ni los efectos de cámara. Reconectar el micrófono adicional conserva su estado
silenciado y el procesador de cámara. Las sesiones con imagen o video grabado
mantienen su vista previa al iniciar. Los eventos de una entrada ya reemplazada
no cambian el estado de la entrada nueva.

Pruebas de esta revisión: suite completa de 94 del servidor, 19 de paridad y audio
de Android y 7 de fundamentos Windows, seguidas de regresiones de los ocho casos
funcionales del emisor. La consola visual se revisa con conexiones simuladas;
las pruebas de sustitución de fuente incluyen permisos denegados, publicación
fallida, restauración, conservación del silencio y desconexión durante la preparación. La prueba de transmisión en hardware Android/Windows sigue pendiente. El despliegue al servidor se completó el 7 de octubre de 2026.

## Interpretación del audio y autonomía

`analysis/worker.mjs` observa el catálogo propio cada 15 segundos. Decodifica
el audio con FFmpeg, mide ataques graves, pulso y dinámica en toda la pista y
usa CLAP (`Xenova/clap-htsat-unfused`, ONNX q8) para comparar descripciones de
género, emoción, intensidad y voces en tres fragmentos de diez segundos. El
audio permanece en el servidor; el modelo se descarga durante la preparación.
La inferencia posterior exige archivos de modelo locales y funciona sin red.

Las similitudes del modelo no son probabilidades calibradas. Se adopta una
etiqueta únicamente si supera 0,4, tiene margen de 0,15 y hay acuerdo en al menos
dos de los tres fragmentos. Esos umbrales son heurísticos y deben calibrarse con
el catálogo real. Los resultados dudosos conservan la clasificación provisional
y aparecen como pendientes de revisión. Las correcciones del administrador
tienen prioridad. La emoción describe el sonido, no cómo se sentirá cada persona.

Los resultados se guardan en `.analysis/<sha256>.json`, separados de `catalog.json`,
para evitar escrituras concurrentes sobre el catálogo. Se comprueba el hash del
archivo antes de analizarlo; otra versión del contenido no reutiliza resultados.
Los fallos se registran y se reintentan después de una hora. Un reinicio retoma
análisis incompletos. El reproductor recibe los resultados actuales al resolver
cada pista, aunque el catálogo se hubiera abierto antes de terminar el análisis.

El DJ usa una rejilla medida únicamente cuando hay pulso fuerte y acuerdo entre
ventanas. Busca una sección de menor intensidad en el último 35 % de la canción
para proponer salida; no afirma haber detectado versos, estribillos o compases.
Interpreta también las voces alrededor de los puntos de entrada y salida. Cuando
hay voces dominantes, información dudosa o tonalidades incompatibles, acorta la
mezcla. Los fragmentos vocales analizados limitan el solapamiento a diez segundos
como máximo. El orden combina curva de energía, emoción, continuidad de tempo y
tonalidad conocida. La autonomía respeta pausa, modo manual y cambios de cola.
No hay sensores de público: la dirección de la pista viene de los controles de
energía y emoción que el usuario elige.

### Ejecución local

Desde `platform/analysis`, instalar con `pnpm install`, preparar el modelo con
`node prepare-model.mjs` y ejecutar `node worker.mjs` con
`QSESSION_ORIGINAL_MUSIC_DIR` apuntando al catálogo propio. FFmpeg se resuelve con
`QSESSION_FFMPEG_PATH`, el paquete existente `@ffmpeg-installer/ffmpeg` o el PATH.
`node worker.mjs --once` procesa una pasada y sale. La preparación requiere red;
las canciones no se envían a Hugging Face.

`deploy/compose.yml` incorpora un servicio `music-analysis` que comparte el
volumen del catálogo con la aplicación. Su imagen Debian incluye FFmpeg y
prepara el modelo durante la construcción, con límite de dos CPU y 2 GB. Este
servicio procesa canciones importadas y existentes automáticamente. No analiza
archivos externos de Audius: éstos mantienen la detección de pulso en el navegador.
La imagen Docker se construyó y desplegó el 7 de octubre de 2026; CLAP se preparó correctamente y el servicio comenzó a guardar análisis del catálogo real, sin reinicios.

## Validación y límites

`node --test test/*.test.js`: 87 pruebas aprobadas en la verificación completa
durante esta mejora, además de las regresiones posteriores del análisis y del
mezclador. `node --test analysis/model.test.mjs` verifica la abstención semántica.
Las pruebas del motor cubren detección, confianza, sincronización, compensación
de nivel por curvas, cancelación y recuperación de fallos. La prueba de navegador
con audio sintético detectó 124 y 126 BPM, ajustó el segundo deck a 124 BPM,
confirmó reproducción simultánea y promoción del segundo deck al acabar.

Una prueba completa de FFmpeg → CLAP → resultado guardado → catálogo y plan de
mezcla utilizó audio sintético sin indicaciones en el nombre. Midió 120 BPM,
encontró la reducción de intensidad e identificó ausencia de voz; se abstuvo de
afirmar un género poco claro. Esto comprueba integración, no precisión musical.

La detección en vivo no identifica de forma fiable voces, estructura completa,
tonalidad o cambios de tempo. El modelo del servidor propone voces y emociones,
sin garantizar exactitud. Los BPM derivados de nombres de archivo sirven
para selección, pero no bastan para afirmar sincronización. Dos elementos HTML
de audio no ofrecen arranque sample-accurate. Falta escuchar sets con el catálogo
real y validar sesiones largas, pantalla bloqueada y redes variables en Android.
Esta implementación no equivale al criterio musical de un DJ profesional.

Estos cambios se publicaron el 7 de octubre de 2026 en qsession.org, junto con la APK Android 0.1.39 (código 40). No se instaló una APK en un teléfono durante esta tarea.

## Preferencia permanente: continuidad del baile (2026-10-08)

Indicación del usuario: «Las transiciones deben respetar un poquito más, solo un poco, la constancia del nivel de emocionalidad que lleva el beat». Evitar bajadas innecesarias de impulso que rompan la conexión del baile; favorecer cambios de energía y tempo graduales, sin aplanar toda la sesión. Respetar una curva descendente o un contexto suave elegidos explícitamente.

Aplicación: preferencia pequeña y acotada por evitar caídas entre pistas; no inferir intensidad emocional únicamente del nombre de una emoción. En mezclas de pulso sincronizado, el bajo entrante alcanza su nivel original en el centro antes de comenzar a retirar el bajo saliente. Los faders siguen siendo complementarios, sin aumentar graves ni ganancia maestra. Los cruces sin sincronización y los contextos suaves conservan su comportamiento anterior. Escuchar y ajustar con sesiones reales: las pruebas técnicas no sustituyen la valoración perceptiva del baile.

## Control manual y volumen durante la mezcla (2026-10-08)

Indicación del usuario: evitar reducir demasiado el volumen durante transiciones y acortar intros o cierres largos que quitan energía al baile. Las barras de energía, emoción y género afectan las siguientes canciones conservando la reproducción actual. La transición manual se solicita de inmediato y se inicia cuando el siguiente deck está disponible, usando un efecto discreto elegido por el DJ.

Conservar la compensación del deck saliente, limitar la reducción del entrante y acortar el centro de menor potencia mediante curvas complementarias. No elevar la ganancia maestra ni reintroducir compresión permanente. Reservar solamente el 10% para los efectos de transición, acotados al 8% de pico. Saltar intros o adelantar cierres únicamente con puntos analizados suficientemente confiables; respetar los contextos suaves. Las pruebas técnicas no certifican el volumen percibido ni el criterio musical del set.
