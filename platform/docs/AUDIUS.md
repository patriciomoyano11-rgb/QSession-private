# Biblioteca musical de QSession

La biblioteca integra una selección editorial de Audius, playlists privadas por cuenta y sesiones automáticas de 15, 30, 45, 60 o 90 minutos. Se abre desde el menú principal o los controles del anfitrión. Para transmitir, elegir **Biblioteca musical** como fuente y comenzar la transmisión existente.

## Selección inicial

75 pistas: 28 electrónica, 14 ambiental/meditación, 25 cumbias, 8 raíces y músicas regionales/fusiones. Los nombres de estilos distinguen tradición, fusión, cumbia electrónica y bass. La cobertura colombiana tradicional sigue siendo limitada; no se rellenan sus categorías con resultados de búsqueda irrelevantes.

La selección se basó en título, etiquetas, descripción, perfil de publicación y disponibilidad. **No se realizó una escucha crítica completa de las pistas**. El campo `review.listened: false` conserva este límite de forma explícita. La energía es una clasificación editorial aproximada, no una medición acústica. El catálogo incluye música de fondo de varios años y algunas publicaciones más recientes; no se presenta como catálogo completo ni como una lista exclusiva de novedades.

Se descartaron de la primera selección covers identificados, bootlegs, remixes, sets largos, pistas bloqueadas o de pago y licencias alternativas sin revisión específica. El filtro no sustituye la comprobación de titularidad: los metadatos son declaraciones de quienes publican. La Open Music License y los créditos se enlazan en la biblioteca y en la canción actual. La reproducción consulta de nuevo los metadatos de Audius antes de comenzar (caché de 60 segundos).

## Funcionamiento y límites

- Las playlists se guardan por cuenta: hasta 20 listas de 100 pistas. Se usa PostgreSQL cuando está configurado; el adaptador de archivo es para desarrollo.
- El generador no repite canciones. Muestra la duración real y el faltante cuando una selección no alcanza el tiempo solicitado. Termina la última canción completa, por lo que puede superar ligeramente la duración pedida.
- Un elemento de audio y una salida Web Audio estables alimentan LiveKit. El micrófono adicional sigue disponible. La canción se comunica mediante atributos del anfitrión para mostrar créditos a oyentes WebRTC.
- **La aplicación del anfitrión debe seguir abierta y activa**. No hay reproducción autónoma en servidor, garantía de segundo plano móvil ni mezclas sincronizadas por BPM. El audio se pausa al detener la transmisión o perder la conexión definitivamente.
- Las direcciones de audio son de Audius. QSession no descarga ni conserva los archivos de las canciones. La disponibilidad depende de Audius.
- El público de HLS no recibe estos atributos WebRTC por este mecanismo. Los créditos siguen accesibles en la biblioteca; la señalización de canción actual sincronizada con la demora de HLS queda pendiente.

## Configuración

La integración de Audius está retirada de la biblioteca pública. `QSESSION_MUSIC_ENABLED=true` mantiene disponible el catálogo propio y `QSESSION_EXTERNAL_MUSIC_ENABLED=false` impide que las selecciones externas aparezcan o puedan reproducirse. `QSESSION_AUDIUS_ENABLED=false` permanece como segunda barrera. La selección histórica se conserva únicamente como referencia técnica y para pruebas internas.

Aplicar la migración `008-music-playlists.sql` con el flujo habitual `node scripts/migrate.js`. Docker incluye los dos módulos y `music-data/audius-selection.json`. La construcción local no publica por sí misma cambios en producción.

## Validación

- `node --test test/music-library.test.js`: elegibilidad, orden, duración, faltantes, ausencia de duplicados, resolución y caché, aislamiento por cuenta, autenticación y persistencia.
- `node scripts/verify-audius-selection.cjs`: consulta los metadatos y pide un rango mínimo de audio, cancela la respuesta y comprueba formato y CORS. El informe va a `tmp/audius-verification.json`; no es una evaluación auditiva.
- Verificación inicial: **51/51** respondieron con HTTP 206, `audio/mpeg` y CORS abierto el 26 de septiembre de 2026 UTC.
- Interfaz revisada en navegador: categorías, agregar canciones, generación automática, reproducción real y pausa.
- Para vista previa aislada: `node scripts/preview-music.cjs`, en `http://127.0.0.1:8098`. Usa datos de prueba en `tmp/music-preview`, sin credenciales de salas de producción.

La publicación y una prueba completa entre anfitrión y oyente en la infraestructura de producción son pasos de despliegue separados.

## Ampliación independiente

Primera tanda: 24 pistas incorporadas localmente (12 cumbias/fusiones y 12 electrónicas), verificadas individualmente por metadatos y respuesta de audio/CORS. Ver [selección y procedencia](AUDIUS-UNDERGROUND.md). Escucha crítica pendiente. No se ha publicado esta ampliación en producción.

## Mantenimiento desde el proyecto

Ejecutar en `platform/`:

- `npm run music:discover`: obtiene candidatos de cumbia y electrónica; no altera el catálogo.
- `npm run music:expand`: incorpora únicamente la lista editorial explícita de `music-data/audius-underground-shortlist.json`, verifica metadatos, identidad del publicador y audio/CORS; omite IDs existentes. No depende de archivos temporales de descubrimiento.
- `npm run music:verify`: comprueba disponibilidad del catálogo completo.
- `npm run test:music`: verifica catálogo, generador, reproducción y playlists.

El catálogo persistente está en `music-data/audius-selection.json`. El constructor de la selección inicial conserva las incorporaciones posteriores. La búsqueda no equivale a aprobación editorial ni a escucha. No hay un panel de curaduría ni un trabajo programado automático todavía.
