# Hoja de ruta: de 1.500 oyentes a 1 millón

Estado: análisis y cambios locales de octubre de 2026. `capacityCertified` sigue en falso. Este documento no anuncia aforo comercial, no despliega nada y no sustituye una prueba nueva. La sala real citada en la operación sigue en el modo anterior hasta que exista evidencia sostenida.

La reconstrucción de la prueba de 1.500 usa los números publicados en `BROADCAST-10000.md` y `LOAD-RETIREMENT.md`, más el código del cliente (`platform/scripts/hls-load-client.py`) y del agregador (`platform/scripts/orchestrate-hls-load.py`). El expediente `release/media-diagnostic-closeout-20261020.json` se cita en esos documentos y no está en este checkout. Donde el JSON decidiría un detalle, el texto lo dice.

No se ejecutó ninguna carga ni ninguna llamada a Cloudflare, Vultr, LiveKit o qsession.org para escribir esto.

## 1. Qué falló a 1.500

La tanda `call_608884c01a19419ca569a6f699db999a` usó un solo generador y dos ejecuciones. La de 1.000 aprobó: 12.929 segmentos completos, cero errores HTTP, cero segmentos incompletos y cero segmentos de más de 6 s. La de 1.500 entregó 19.786 segmentos completos con esos mismos contadores a cero. Se conservó como fallida porque una muestra de la ventana estable tuvo 1.484 receptores recientes y el tramo común completo fue de 48 s, frente a los 50 s exigidos.

Eso no es una caída de reproducción. El volumen por cliente sube, no baja:

| Ejecución | Clientes | Segmentos completos | Segmentos por cliente |
| --- | ---: | ---: | ---: |
| Aprobada | 1.000 | 12.929 | 12,93 |
| Fallida por continuidad | 1.500 | 19.786 | 13,19 |

19.786 / 12.929 = 1,53, por encima de la razón de clientes 1,5. El origen sintético, el Worker y R2 entregaron los cuerpos. No hubo 503, 502, cuerpos truncados ni descargas marcadas como tardías. El propio informe de la tanda dice que este resultado no explica los cuerpos truncados de las pruebas de 10.000.

### Cómo se mide la continuidad

El cliente no decodifica. Cada 2 s cuenta cuántos clientes activos recibieron un segmento en los últimos 12 s (`RECENT_MEDIA_SECONDS`). Un cliente se declara parado solo si pasan 18 s sin un segmento (`STALL_SECONDS`). Una descarga cuenta como tardía solo si supera los 6 s del segmento.

La rampa dura 30 s y el hold de esa tanda era 60 s. La ventana estable del agregador va del segundo 38 al 88: 26 muestras, 50 s. El tramo común es `2 * (última muestra llena - primera muestra llena)` en esa rejilla de 2 s.

Un tramo de 48 s con una sola muestra en 1.484 encaja con una única muestra corta en un extremo de la ventana:

- Si falla solo la muestra del segundo 38, el tramo lleno que queda es 40–88 = 48 s.
- Si falla solo la muestra del segundo 88, el tramo lleno que queda es 38–86 = 48 s.
- Si la muestra corta estuviera en el interior, el tramo más largo sería menor de 48 s. Una prueba local reproduce las dos formas.

1.484 es 16 clientes, el 1,07 % de 1.500. El proceso de cada generador se da por bueno si existe al menos una muestra con todos sus clientes (`bool(full_media)`). El fallo publicado es el del agregador, que exige las 26 muestras alineadas. Un proceso puede informar `deliveryCheckPassed` y la tanda igual falla por esa muestra extrema.

### Por qué 16 clientes pueden salir de la ventana sin un error HTTP

El segmento dura 6 s y el cliente vuelve a pedir el manifiesto cada 1,7–2,3 s. La ventana de “recién recibido” es exactamente dos segmentos. Un cliente que descarga cada segmento en menos de 6 s, y por tanto no suma `segmentDownloadOver6Seconds`, puede quedar fuera de los 12 s si se alinean la espera del siguiente segmento, el sondeo y el tiempo de descarga. Tampoco llega al paro de 18 s.

En el extremo de la rampa el margen es más estrecho. El último cliente arranca casi en el segundo 30. La primera muestra estable es el segundo 38: le quedan unos 8 s para TLS, manifiesto y el primer segmento de alrededor de 1,4 MB, con la máquina ya llena. En el otro extremo, el plazo de la prueba es el segundo 90 y la última muestra estable es el segundo 88; una descarga todavía en curso deja el `last_progress` anterior justo fuera de los 12 s.

Sin el JSON de muestras no se puede elegir entre el segundo 38 y el 88. Las dos lecturas son del generador y del criterio, no del Worker. A 1.000, en la misma máquina, ese margen alcanzó. A 1.500, 16 clientes no cupieron en una sola muestra de 2 s.

Un generador a 1.500 oyentes del perfil ensayado tiene que absorber del orden de 2,6 a 2,9 Gb/s (ver las fórmulas de la sección 6). La tanda no registró margen de NIC. Cero descargas de más de 6 s indica que los cuerpos que terminaron cupieron en un intervalo de segmento. No demuestra que la NIC tuviera holgura, y tampoco hace falta esa holgura para explicar una sola muestra extrema.

## 2. Cuello de plataforma y artefacto del laboratorio

### Artefacto del laboratorio: la continuidad de 1.500

La falla de 1.500 es un artefacto de medición en un solo generador. La entrega HTTP de esa ejecución estuvo limpia. El agregador ahora exige el aforo completo solo entre el segundo 40 y el penúltimo de la ventana. Una muestra corta en el segundo 38 o en el último queda como `endpoint-sample` y no suspende la tanda. Un hueco interior sigue suspendiéndola. La tanda histórica del 20 de octubre no se reescribe: en su momento el criterio incluía los extremos y el resultado archivado sigue siendo fallido. El Worker no cambia por este caso.

### Cuellos de plataforma, vistos en las tandas de 10.000 y en el código

Esas tandas mezclan saturación del generador con errores HTTP. No hay una causa única. Sí hay mecanismos que a 10.000 ya devolvieron 503 y que a 100.000 y a 1 millón no caben en un solo Redis ni en un isolate.

1. **Admisión en cada GET.** El Worker comprueba el token HMAC y después la concesión, antes de leer la caché. La clave de caché de medios es la URL canónica, sin `qsat`, así que los segmentos sí se comparten entre oyentes. La admisión no se salta en un HIT. La tabla RAM por isolate es de 65.536 huellas SHA-256 y caduca a los 20 s (2.621.440 bytes). La Cache API de aprobaciones también es por centro de datos. Cada concesión fría, en cada colo, llama al API y al script Lua de Redis. A 1.500 eso es invisible (la tanda tuvo cero 503). A 1 millón, renovar todas las concesiones cada 20 s son unas 50.000 evaluaciones por segundo del mismo ZSET.

2. **El script Lua es un solo contador.** `platform/broadcast-admissions.js` hace `ZREMRANGEBYSCORE`, `ZCARD` y `ZADD` sobre una clave por sala. Es correcto para un aforo exacto. Es un hotspot de un hilo de Redis cuando el ingreso y la renovación dejan de ser miles de operaciones por segundo.

3. **Límites por isolate, no de la red.** Lecturas R2 simultáneas del canario: 4, con 16 en cola. Llenados de caché: 64, 192 esperas por objeto y 384 en total, plazo de 4 s. La caché compartida del Durable Object: 24 MiB, 4 lecturas y objetos de hasta 8 MiB. Cuando el llenado no queda retenido, la petición termina en 503 `edge-not-retained` y no reintenta contra el actor. En la rampa de 10.000 del 20 de octubre hubo 10.021 HTTP 503 de segmento con `edge-not-retained` / `cacheFill_failed`. Otra tanda registró 1.444 `shared-overloaded` y 36.142 errores de comprobación de admisión dentro de 43.493 HTTP 503. Esos códigos son de la plataforma. También hubo procesos del laboratorio muertos a los 24–28 s y CPU steal: esa parte es del generador y no se puede restar con los datos publicados.

4. **Un solo Egress.** El codificador de producción citado en la operación es una VM de 4 vCPU. El reemplazo manual en laboratorio devolvió señal a un receptor nuevo a los 31 s y al mismo proceso a los 39 s. No hay conmutación automática. Dos escritores no pueden reutilizar las mismas claves de segmento.

5. **Un solo rendition de 6 s.** H.264 1280×720 a 1,6 Mb/s más AAC 128 kb/s. La lista en vivo guarda como máximo 5 segmentos. No hay audio solo ni peldaños inferiores. A escala, el oyente con un enlace malo solo puede fallar o seguir pidiendo 720p.

6. **Chat y WebSocket.** El ejemplo de entorno limita el tiempo real a 6.000 conexiones. El modo `cdn-only` descrito en `MASS-BROADCAST-500K.md` no abre el chat de la sala para el oyente. Volver a conectar a cada oyente al SFU, o a un WebSocket de la API, deshace el diseño. Postgres guarda el historial; no es un fan-out de un millón de sockets.

7. **El reto de Cloudflare** en `live.qsession.org` (regla HTTP DDoS al imitar un navegador) ya se evitó cambiando el User-Agent del cliente de carga. Sigue siendo un riesgo si una prueba futura usa un UA de navegador contra el hostname de producción. El staging tiene que vivir en otra zona para no heredar esa regla ni poder dispararla.

## 3. Cambios de este cambio

Se implementó lo que un test local puede comprobar. El Worker no se modificó.

- `platform/scripts/load_target_policy.py` rechaza los hosts de reproducción de producción (`live.qsession.org`, `qsession.org` y cualquier subdominio, `www`, `media`, y `qsession-live.patriciomoyano11.workers.dev`), las tres IPv4 permanentes (104.238.137.144, 45.77.192.82, 45.77.118.43) y el bucket y el endpoint R2 de producción. Un hostname de carga tiene que llevar una etiqueta DNS `staging` (o `staging-` / `-staging`). No hay variable de entorno que lo desactive. La comprobación del hostname vive dentro de `hls-load-client.py`, que es el único archivo que se sube al generador; el orquestador copia esa misma función al controlador remoto.
- El cliente de carga, el orquestador (también el script que corre dentro del generador), el publicador sintético, el minteo de concesiones, el observador Redis y la limpieza exigen ese destino. `run-custom-domain-load.py` corta antes de cualquier SSH si faltan `--delivery-host`, `--encoder-host` y `--api-host` de staging.
- El piloto de un cliente conserva `--known-canary` / `allow_known_canary=True` para los dos hostnames históricos de PRB10A. Los comandos de carga no lo activan.
- El agregador añade `steadyShortfallClass`: `none`, `endpoint-sample`, `interior-or-sustained`, `incomplete-window` o `no-steady-samples`. El aprobado exige todas las muestras interiores (del segundo 40 al penúltimo). Una o las dos muestras extremas pueden ir cortas. Si falta un slot, aunque sea un extremo, la tanda falla.
- El Worker, por defecto, acepta el segmento si el token HMAC es válido y no venció. No llama a Redis en cada GET. `QSESSION_ADMISSION_BACKEND=required` recupera la comprobación anterior. Una expulsión espera a que venza el token. Un token inválido o vencido sigue en 403 y no lee R2.
- Si la caché rechaza la escritura pero el cuerpo ya se leyó completo (hasta 8 MiB el segmento, 64 KiB el índice), la respuesta sale igual, con `X-QSession-Cache-Fill-State: verified`. Un cuerpo a medias sigue siendo 503.

Pruebas locales: `python3 -m unittest discover -s test -p 'test_hls_*.py'` y `test_load_target_policy.py` desde `platform/`. No sustituyen una carga.

## 4. Staging aislado

El staging no es un hostname nuevo en la zona `qsession.org`. El guardia rechaza `*.qsession.org` a propósito: un registro en la zona de producción comparte cuenta, DNS y reglas de WAF. Hace falta otro nombre, otro Worker, otro bucket, otro Redis, otra API y otras máquinas.

Nombres propuestos, todos distintos de producción:

| Pieza | Producción, no usar en carga | Staging |
| --- | --- | --- |
| Worker | `qsession-live` | `qsession-live-staging` |
| Bucket R2 | `qsession-live` | `qsession-live-staging` |
| Reproducción | `live.qsession.org` | `live.staging.qsession.test` o `qsession-live-staging.<cuenta>.workers.dev` |
| API | `qsession.org` en 104.238.137.144 | Otra VM, otra IPv4, `api.staging.qsession.test` |
| Redis | El de esa API | Instancia propia, sin túnel hacia producción |
| Codificador | 45.77.192.82 | Otra VM, sin las claves S3 del bucket de producción |
| Sala técnica | `PRB10A` en el bucket real | Un código que no sea una sala en emisión, en el bucket de staging |

La cuenta de Cloudflare del staging debería ser otra. Si tiene que ser la misma cuenta, el Worker de staging no lleva la ruta `live.qsession.org` y el token de API de R2 solo puede leer y escribir `qsession-live-staging`.

### Configuración que hay que aplicar cuando exista el entorno

No está aplicada. No hay secretos en el repositorio. Ejemplo de Worker, al lado de `platform/edge/wrangler.toml.example`:

```toml
name = "qsession-live-staging"
main = "hls-worker.js"
compatibility_date = "2026-09-23"

[[r2_buckets]]
binding = "QSESSION_LIVE"
bucket_name = "qsession-live-staging"
preview_bucket_name = "qsession-live-staging-preview"

# Zona distinta de qsession.org. No adjuntar live.qsession.org.
# Ciclo de vida: borrar el prefijo live/ al cabo de un día.
```

Variables de la API de staging, en un archivo privado de esa VM, nunca en git. Los valores de abajo son nombres, no credenciales:

```sh
QSESSION_PUBLIC_URL=https://api.staging.qsession.test
QSESSION_REDIS_URL=redis://127.0.0.1:6379
QSESSION_BROADCAST_STORAGE_BUCKET=qsession-live-staging
QSESSION_BROADCAST_STORAGE_ENDPOINT=https://<cuenta-staging>.r2.cloudflarestorage.com
QSESSION_BROADCAST_STORAGE_PLAYBACK_BASE_URL=https://live.staging.qsession.test
QSESSION_EDGE_PLAYBACK_BASE_URL=https://live.staging.qsession.test
QSESSION_HLS_SEGMENT_SECONDS=6
QSESSION_HLS_VIDEO_BITRATE=1600000
QSESSION_HLS_AUDIO_BITRATE=128000
QSESSION_AUDIENCE_MODE=interactive
```

`QSESSION_AUDIENCE_MODE` se queda en `interactive` hasta que el expediente de esa sala de staging esté completo. El archivo de credenciales del origen sintético tiene que traer `bucket` con `staging` en el nombre y un endpoint distinto de `https://b3d60daa8319692b18a8bef39b34f14d.r2.cloudflarestorage.com`. Si trae el bucket de producción, el script sale antes de subir.

Invocación, solo contra ese entorno:

```sh
python3 platform/scripts/run-custom-domain-load.py \
  --delivery-host live.staging.qsession.test \
  --encoder-host 10.8.0.5 \
  --api-host 10.8.0.6 \
  --inventory <inventario-de-staging> \
  --suffix media-staging-1000 \
  --clients 1000 --hold 60 --transport aiohttp
```

Las direcciones del ejemplo son de documentación privada. Hay que sustituirlas por las IPv4 del staging. 104.238.137.144, 45.77.192.82 y 45.77.118.43 las rechaza el proceso antes de abrir SSH.

`prepare-retirement-scope.py` todavía puede anotar `deliveryHost=live.qsession.org` en un libro de una tanda histórica. El orquestador rechaza ese valor. Un inventario nuevo tiene que traer el hostname de staging.

## 5. Escalera 1.500 → 10.000 → 100.000 → 1.000.000

Cada peldaño se corre en staging, con presupuesto y retirada propios. Un fallo interior para el avance. Una muestra extrema corta, con el HTTP en cero, no basta para declarar que el borde no aguanta. Sigue haciendo falta NIC medida. El Worker no se cambia por un `endpoint-sample`.

### 1.500, repetir en staging para cerrar el artefacto

- Dos generadores como mínimo, cada uno por debajo de la mitad de su NIC medida. 1.500 × 1,7 Mb/s son 2,55 Gb/s: una sola VM barata está en el límite o por encima.
- Publicar en el informe `steadyShortfallClass`, CPU steal, `rxMbps` y la velocidad de enlace. Si la NIC no se observa, la tanda es inconclusa aunque el HTTP salga limpio.
- Hold de 60 s. El interior, del segundo 40 al 86, tiene que mostrar 1.500 receptores recientes en cada muestra. Un `endpoint-sample` con contadores HTTP a cero cierra el artefacto. Un hueco interior (`interior-or-sustained`) detiene el avance.

### 10.000, primer objetivo del producto

Hace falta que el borde aguante la ráfaga de admisión y de llenado, no solo que un generador descargue bytes.

- Repartir 10.000 clientes en generadores cuya NIC medida cubra, con el 50 % libre, su parte de ~17 Gb/s. Siete VM a ~2,4 Gb/s cada una repiten el techo que ya mezcló errores de generador con 503.
- Canario R2 ya publicado solo para la sala técnica: conservarlo en staging y medir, por código, `edge-not-retained`, `shared-overloaded`, `backend-timeout` y `cacheFill_failed`. Un 503 de esos códigos es fallo de plataforma aunque la CPU del generador esté baja.
- Subir el escudo de origen y la caché por niveles de Cloudflare delante del bucket de staging, con la clave canónica que el Worker ya usa (sin `qsat`). Comprobar que un solo GET a R2 sirve a muchos isolates del mismo colo. Los límites de 4 lecturas y 64 llenados son por isolate: el escudo tiene que hacer que el miss sea raro.
- Dejar el segmento en 6 s para esta meta. Bajarlo multiplica peticiones antes de tener el HIT medido.
- Un segundo Egress en frío, con otro prefijo, ensayado en staging. El corte manual de laboratorio (decenas de segundos) no sirve como failover de un show. El criterio de esta etapa es conmutar el manifiesto sin 503 masivo y con un hueco menor que dos segmentos para un cliente ya conectado.
- Admisión: seguir con el Redis único para 10.000 ingresos. El laboratorio ya admitió 10.000 en ~30 s en loopback; falta la misma cifra contra el API de staging con la renovación de los GET, no solo el `reserve`. Si los 503 de admisión reaparecen, el siguiente paso es validar el HMAC en el borde y reservar el Redis para el ingreso, no para cada segmento.
- Chat: el modo audiencia de esta meta no abre el chat del oyente. No sumar 10.000 WebSocket a la misma API.
- Observabilidad de la sección 7 activa, con aborto automático. Sin eso, no hay otra tanda de pago.

10.000 a 1,7 Mb/s son 17 Gb/s y unos 7,7 TB por hora de contenido. Cabe en un contrato Cloudflare razonable. No cabe en el plan Workers de 5 USD como si el tráfico fuera residuo.

### 100.000

Aquí el contador único y el Worker-en-cada-GET pasan a ser el límite, no la NIC de un puñado de VM.

- Escalera ABR de verdad: 720p (~1,6 Mb/s), 480p (~0,8 Mb/s), 240p (~0,3 Mb/s) y audio solo (AAC 64–128 kb/s). El empaquetador vive junto al Egress, una vez por sala, no por oyente. El manifiesto maestro se cachea como el índice, con TTL corto. El peor caso de planificación sigue siendo “todos en 720p”. La escalera sirve para que un enlace malo baje de peldaño en vez de hacer stall.
- Segmentos de 4 s solo si el HIT de segmento en el escudo supera el umbral de la sección 7. Si no, quedarse en 6 s. LL-HLS (partes de unos 200–500 ms) multiplica por diez o más las peticiones de índice y de parte: a 100.000 eso es un problema de plano de control, no una mejora de calidad. No activarlo en este peldaño.
- Admisión fragmentada. Partir el aforo en N claves Redis (`lease % N`) con suma, o dar a cada región un cupo con un margen pequeño de sobreventa. El script Lua actual no se puede llamar en cada segmento. El borde valida el HMAC y la caducidad; Redis solo se consulta al entrar, al renovar la concesión (cada decenas de segundos, no cada segmento) y al revocar.
- Dos Egress activos en prefijos distintos y un cambio de manifiesto cuando la edad del índice pasa de un segmento. El público no vuelve al SFU.
- Chat muestreado: un porcentaje bajo puede publicar; el resto lee una instantánea cacheada en el borde cada varios segundos. Nada de un socket por oyente en la API de la sala.
- La prueba de 100.000 no descarga 170 Gb/s desde Vultr. Sigue el método de la sección 8.

### 1.000.000

1.000.000 × 1,7 Mb/s = 1,7 Tb/s, unas 765 TB decimales por hora de contenido antes de TLS y de margen. Es un contrato con el proveedor de CDN, un escudo regional y un plano de control que no crece con los espectadores.

- El token de reproducción se valida solo en el borde. La revocación es una lista corta o una generación dentro del token, no un `ZSCORE` por GET. El contador de aforo, fragmentado por región, solo corre en el ingreso.
- ABR obligatorio en el contrato de capacidad: dimensionar el pico con el peldaño alto y publicar también el audio solo. Un millón de oyentes en redes móviles no van a sostener 720p a la vez; el diseño igual tiene que sobrevivir si lo intentan.
- LL-HLS solo con un número medido de peticiones por oyente y con el escudo ya estable. A 1 millón, partes de 0,5 s son del orden de 2 millones de peticiones de media por segundo, además del índice. El costo de petición del Worker, no el códec, es el que rompe el presupuesto.
- Egress redundante por región de origen, con el empaquetador delante de R2. La caída de un codificador cambia de prefijo. No se reescribe el bucket de otra región a mano.
- Chat: el evento masivo no tiene chat de oyentes, o tiene la instantánea muestreada de la etapa anterior. Presencia, GPS, sondeos de directorio y recompensas siguen pausados, como ya hace el modo `cdn-only`.
- Varias regiones de caché con escudo propio. R2 atiende a los escudos, no a los oyentes. El número de GET de origen es `renditions / duración_de_segmento × escudos`, no el número de espectadores.
- La prueba de un millón de descargas completas no se hace con una flota propia. Se compone como dice la sección 8 y se contrata capacidad de pico con el CDN.

## 6. Ancho de banda y coste

Las cifras de dinero son supuestos de lista para revisar en el panel del proveedor. No son una cotización, no incluyen impuestos y no son el cargo observado de Q Session. Los anchos de banda sí salen de la fórmula; el precio unitario no.

Bitrate de planificación que pidió el objetivo, redondeado:

```text
B = 1,7 × 10^6 bit/s
Gb/s = N × B / 10^9
TB/h (decimal, 10^12 bytes) = N × B × 3600 / 8 / 10^12
```

| Oyentes N | Salida | Por hora de contenido |
| ---: | ---: | ---: |
| 1.500 | 2,55 Gb/s | 1,15 TB |
| 10.000 | 17 Gb/s | 7,65 TB |
| 100.000 | 170 Gb/s | 76,5 TB |
| 1.000.000 | 1,7 Tb/s | 765 TB |

El perfil configurado es 1.600 + 128 = 1.728 kb/s, un 1,6 % por encima de 1,7. Un segmento medido del canario, 1.431.620 bytes en 6 s, son 1,91 Mb/s. Para cabeza de red, multiplicar la tabla por 1,91 / 1,7 ≈ 1,12. Con el margen de ingeniería del 20 % que ya usa `MASS-BROADCAST-500K.md`, 1 millón a 1,7 Mb/s pasa a 2,04 Tb/s y 918 TB/h.

Peticiones que hoy entran al Worker, porque la admisión corre antes de la caché. El cliente sondea el manifiesto cada ~2 s y baja un segmento cada 6 s:

```text
R = N × (1/2 + 1/6) = N × 2/3   peticiones/s
```

| N | Peticiones/s | Peticiones por hora |
| ---: | ---: | ---: |
| 1.500 | 1,0 × 10^3 | 3,6 × 10^6 |
| 10.000 | 6,7 × 10^3 | 2,4 × 10^7 |
| 100.000 | 6,7 × 10^4 | 2,4 × 10^8 |
| 1.000.000 | 6,7 × 10^5 | 2,4 × 10^9 |

Lecturas de origen si el escudo funciona. `S` escudos, `K` renditions, segmento de `D` segundos:

```text
GET de R2 por segundo ≈ S × K / D
```

Con `S = 20`, `K = 1`, `D = 6`, son unas 3 lecturas por segundo, no 167.000. El ahorro existe solo si la clave no incluye el token. El Worker ya construye esa clave canónica. Hay que medirlo en staging: un miss por oyente anula la fórmula.

### Supuestos de precio, a verificar

No copiar estos números a un presupuesto sin abrir el panel.

- Workers de pago, supuesto de lista: 5 USD al mes, 10 millones de peticiones incluidas, y del orden de 0,30 USD por millón adicional. A 1 millón de oyentes y 2,4 × 10^9 peticiones por hora, el tramo incluido no importa: 2,4 × 10^9 / 10^6 × 0,30 ≈ 720 USD por hora solo en peticiones, si cada GET se factura. El CPU del HMAC es otro renglón; hay que medirlo, no estimarlo desde aquí. Este es el motivo para que un HIT de segmento no ejecute lógica de más, y para negociar el tramo de vídeo con Cloudflare antes de un evento de 100.000.
- R2, supuesto de lista: almacenamiento del orden de 0,015 USD por GB-mes; escrituras de clase A del orden de 4,50 USD por millón; lecturas de clase B del orden de 0,36 USD por millón; salida hacia la red de Cloudflare sin cargo de egress. Con el escudo, la factura de R2 es pequeña al lado de las peticiones del Worker. Sin escudo, las lecturas de clase B se acercan a `R` y el origen se cae antes por concurrencia que por la factura.
- Salida de CDN a 1,7 Tb/s no entra en el plan de 5 USD. Un supuesto de industria, no un precio de Cloudflare, es `P` USD por GB entregado. A 765.000 GB por hora, el cargo es `765000 × P` USD/h. Con un P de 0,005 USD/GB salen unos 3.800 USD/h; con 0,001, unos 765 USD/h. Hay que sustituir `P` por el anexo del contrato. Marcar cualquier cifra de este párrafo como supuesto.
- Codificador actual, ya observado en la operación: base de 48 USD al mes por la VM de 4 vCPU. No transcodifica un millón de sesiones; transcodifica una. Cada peldaño ABR suma CPU en esa máquina o en un packager, no en el público.
- Generador de la tanda de 1.500: se observó 0,132 USD/h en esa máquina, dentro de una reserva de 0,30 USD. No extrapolar ese precio a una flota. Una flota que absorbiera 1,7 Tb/s a 10 Gb/s útiles por máquina serían unas 170 máquinas; a 3 Gb/s útiles, unas 570. No es el camino de la sección 8.
- Redis y la API de staging: una VM pequeña basta mientras el borde valide el token. El costo que importa es el hotspot del script Lua, no el alquiler.

Fórmula única para no mezclar unidades:

```text
coste_hora ≈ peticiones_hora / 10^6 × precio_por_millón
           + bytes_hora / 10^9 × P_usd_por_GB
           + lecturas_R2_hora / 10^6 × precio_clase_B
           + máquinas_de_origen × precio_hora
```

El segundo término domina si el CDN cobra la salida. El primero domina si cada oyente despierta un Worker y la salida va incluida. Hay que medir cuál de los dos aplica al contrato real antes de prometer 10.000.

## 7. Abortar solo

La orquestación ya para por errores persistentes (más del 10 % y más de 100) y por tres muestras seguidas de CPU al 95 %, memoria libre por debajo de 128 MiB o retraso del event loop de más de 1 s. Eso no alcanza. En staging, abortar y retirar máquinas si durante 30 s se cumple cualquiera de estas condiciones:

- HTTP 5xx de segmento o de manifiesto por encima del 0,1 % de las peticiones.
- Cualquier código `edge-not-retained`, `shared-overloaded`, `backend-timeout` o `cacheFill_failed` en más del 0,1 % durante esos 30 s.
- p99 de descarga de segmento por encima de la duración del segmento.
- `steadyShortfallClass=interior-or-sustained`, o receptores recientes por debajo del 99 % en tres muestras seguidas que no sean el primer o el último slot de la ventana.
- CPU steal sostenido, o `rxMbps` por encima del 80 % de la NIC medida. Esa tanda queda inconclusa, no como fallo del borde.
- Edad del manifiesto por encima de dos segmentos, o Egress distinto de activo.
- El gasto acumulado de la tanda cruza el techo autorizado. La reserva no es el cargo; el aborto usa el techo igual.

Un solo `endpoint-sample` con el resto de contadores a cero no aborta el diagnóstico: se etiqueta y se archiva. No se reintenta la misma tanda en automático.

Hace falta exportar, sin tokens ni claves de objeto, la tasa de HIT de la clave canónica, la fase de admisión y la edad del manifiesto. El Worker ya emite códigos constantes como máximo una vez cada 30 s por isolate; el panel de Cloudflare tiene que ser la fuente del aborto, no solo el JSON del generador.

## 8. Cargar por encima de ~10.000 sin una flota Vultr

A 10.000 × 1,7 Mb/s hacen falta unos 17 Gb/s de descarga real si cada cliente baja el segmento entero. Eso todavía se puede repartir en unas pocas máquinas con NIC de 10 Gb/s medida y la mitad libre. A partir de ahí, alquilar cientos de VM para hundir el tráfico no mide el borde: mide la factura del laboratorio y vuelve a mezclar CPU steal con 503.

Partir la prueba en piezas que quepan en pocas máquinas:

1. **Llenado de origen.** Un cliente por objeto nuevo comprueba que el Egress escribe, que el escudo lee R2 una vez y que el segundo cliente del mismo colo ve HIT. El tráfico de origen es `S × K / D`, no `N × B`.
2. **HIT en un colo.** Una máquina, o tres, en una región, con tantos clientes como su NIC aguante al 50 %. Se exige HIT de la clave canónica en casi todos los segmentos después del primer llenado. Si el HIT no aparece, parar: más clientes solo amplifican el origen.
3. **Admisión aparte.** El bench del script Lua y del HMAC en workerd local no descarga vídeo. Ya hubo 10.000 reservas en loopback en unos 30 s. Repetirlo en el Redis de staging hasta la tasa de la etapa (500 reservas/s sostenidas para 10.000 con TTL de 20 s; 5.000/s para 100.000). Eso cabe en una VM.
4. **Muestreo de cuerpo completo.** Del orden del 1 % de los clientes de la prueba descargan el segmento entero y miden el p99. El resto solo pide el manifiesto y el primer kilobyte, o confía en el contador de bytes del CDN. El 1 % tiene que ser bastante para ver truncados. No presentar el 99 % corto como 100.000 reproducciones.
5. **Audio solo para el plano de control.** Una pasada a 100.000 con el peldaño de ~128 kb/s son unos 13 Gb/s, del tamaño de la prueba de 10.000 en 720p. Sirve para admisión, índice y reconexión. No certifica el vídeo.
6. **Contadores del CDN.** Bytes servidos, HIT, 5xx y CPU del Worker, leídos del panel, son la evidencia de capacidad. El JSON del generador es la evidencia de que el cliente recibió lo que pidió. Hacen falta los dos. Ninguno de los dos es una flota de 1,7 Tb/s.
7. **Contrato, no VM.** El tramo de 100.000 y el de 1 millón se cierran con el compromiso de pico del proveedor más las piezas 1–6. Un proveedor de replay, si se contrata, tiene que apuntar al hostname de staging. El guardia rechaza `live.qsession.org` aunque el replay sea de un tercero.

## 9. Qué queda fuera

Este texto no certifica 10.000 ni 1 millón. No cambia el aforo de una sala real. No despliega el Worker ni crea el bucket de staging. La decodificación en Windows, Chrome y Android, el cambio de red y el bloqueo de pantalla siguen pendientes sobre la ruta protegida, igual que antes.

El siguiente trabajo de producto, en orden: montar el staging de la sección 4, repetir 1.500 con NIC medida, y solo entonces una tanda de 10.000 cuyo aborto distinga `endpoint-sample` de un 503 de admisión o de caché.
