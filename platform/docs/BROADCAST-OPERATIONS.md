# Operación y ensayos de la transmisión de 10.000

Último cambio publicado: `media-diagnostics-closeout-20261020.json`, versión
`2c930d8422f44775a21e4a82c1d29903`, autorización `call_ee42755e79394eebbfcff07af67dda45`.
99 pruebas unitarias y piloto local oficial de 96 solicitudes/seis fallos simulados
aprobados. Añade códigos de diagnóstico permitidos, logs acotados y registro del
motivo/capa en el cliente; conserva admisión, aforo, plazos, reintentos y caché.
Es instrumentación, no una reparación del streaming certificada. Publicador:
`platform/scripts/publish-media-diagnostics.py --approval <aprobación nueva> --publish`.
La publicación comprobó hash remoto anterior `9f6364d5...`, candidato `6cfcc2de...`,
los seis enlaces y namespace existentes. No repetir con esta autorización ya
completada. PRB10A renovada, API 200 y sin reiniciar los servicios de medios.
Piloto HTTP de un cliente aprobado: 16/16 rangos, segmento completo, cero errores,
acceso no autorizado 403 y renovación de 27.951 ms. Leases a cero y archivos/objetos
técnicos limpios; trabajos de medios sin cambios durante el piloto. Wrangler
revocado a las 04:21:28 UTC, archivos OAuth retirados. Cero servidores nuevos,
sin reabrir Vultr. Este paso no validó reproducción decodificada ni 10.000.

Última tanda: `release/repeat-load-closeout-20261020.json`. Pasaron las dos
confirmaciones de 1.000; se crearon los seis generadores condicionales y se
ejecutó una sola carga de 10.000 durante 650 s. Falló: ventana común completa
de cuatro segundos (requisito 610), 11.557 respuestas incompletas, 915 HTTP 503
y 16.243 timeouts. Reconectaron 996 de 1.008 previstos; máximo 13,9 s, sobre 12 s.
No certificar capacidad ni activar el aforo comercial.

El timer eliminó los siete, con ausencia comprobada y tres permanentes sanos.
Se limpiaron leases y objetos propios, se retiró la clave remota, se revocó la
temporal en Vultr, se restauró la ACL y se deshabilitó la API. Cero temporales.
US$2,10 reservados para esta tanda; total de etapa máximo US$3,60 incluyendo
US$1,20 previamente observados y US$0,30 previos todavía sin cargo verificado.
Facturación por uso e impuestos aparte. No otra carga masiva autorizada.

La espera fija de 90 s perdió el informe tardío de limpieza del publicador;
se comprobó por separado que no quedaban objetos de su run exacto. Corrección
local: esperar hasta cierre previsto más margen acotado y recoger el informe
también en `finally`, sin ocultar fallos previos. 43 pruebas HLS aprobadas.
No presentar ese arreglo del controlador como solución de las descargas.
La causa del streaming sigue abierta: respuestas 200/HIT incompletas, patrón
de 1.040.384 bytes en primeras muestras y 503 de caché sin traza detallada.

Tanda anterior: `release/sustained-load-closeout-20261020.json`. Autorizada hasta
siete, creó sólo una máquina: primera confirmación de 1.000 con 13.032 fragmentos
completos, cero fragmentos tardíos/incompletos, pero seis timeouts de admisión.
Falló; no se hicieron la segunda ni la carga de 10.000. El timer la eliminó,
se verificaron cero temporales y los tres permanentes saludables; clave revocada,
ACL anterior restaurada y API deshabilitada. Reserva de la única máquina US$0,30,
cargo real aún no verificado; no contarlo como gasto observado.

Corrección de timeout publicada, versión `c21dc766`: 45 pruebas
y 768 solicitudes workerd aprobadas. Primer intento hasta 1,75 s; máximo de dos
intentos bajo el mismo plazo total de cuatro segundos, sin admitir tras vencer
ese plazo ni reintentar denegaciones o certificados inválidos. La lentitud del
backend no tiene causa raíz establecida. Se publicó con
`call_a2f6963d39e74c4099bf385107ee0a8d`; fuente y seis enlaces se verificaron por API.
Piloto protegido de un cliente aprobado: 16/16 rangos, rechazo sin autorización,
renovación y liberación a cero. Archivos privados retirados y medios sin cambios.
Wrangler revocado oficialmente a las 03:06:16 UTC. No crea recursos ni modifica
aforo o DNS. En aquel paso no hubo carga masiva ni reproducción decodificada. Evidencias
`release/admission-deadline-*20261020.json`.

Estado anterior: `release/hls-diagnostic-closeout-20261020.json`.
App publicada `private-groups-v1`; Worker entonces `61509bb6` con reintento de
admisión y recuperación acotada de lectura del manifiesto. 96 pruebas de app y
39 de borde aprobadas; runtime local oficial: 768 solicitudes y tres fallos
simulados aprobados. Publicación autorizada en
`call_ae5484f689964133ad2f4a9c30f8f04a`, seis enlaces intactos verificados por API.
El piloto HTTP protegido de un cliente pasó 16/16 rangos, rechazo sin acceso,
renovación y liberación a cero; archivos privados retirados y sesión Wrangler
revocada a las 02:18:22 UTC. No se crearon servidores ni se reactivó Vultr.
Evidencias `release/manifest-recovery-*20261020.json`. No hubo decodificación
audiovisual ni carga masiva en este paso.
Una carga de 1.000 con la versión anterior pasó; su confirmación falló por 502 y timeout
de manifiesto. No certificar ni activar 10.000. La comparación de caché fue
revertida: ambos selectores permanecen en PRB10A. La causa completa del manifiesto
sigue sin establecer; no atribuirla a OOM, al actor ni al generador sin evidencia.

El timer retiró el único generador del diagnóstico. Tres permanentes saludables,
cero temporales, claves locales y del proveedor retiradas, API deshabilitada,
lista previa restaurada y sesión Wrangler cerrada. Informes `diagnostic-*20261020`
en `release/`. Cómputo observado: US$0,15 adicional y US$1,20 de los US$3 nuevos,
sujeto a factura e impuestos/Cloudflare separados. Los permisos de carga de esta
sesión se consumieron; no crear otro generador ni repetir carga pagada sin el
alcance y saldo revisados. La propuesta masiva quedó aplazada por la regresión.

Registro anterior del 19 de octubre, después de las 19:56 de Colombia:
`release/broadcast-10000-closeout-20261020.json` (fecha UTC). Se ejecutaron tres
cargas sobre la caché privada y su variante con caché local de CDN; las tres
fallaron los criterios de continuidad. El mayor pico completo fue de 10.000
recientes durante 8 s antes de la corrección; la última quedó en 9.995 recientes,
401 fragmentos tardíos y 40 clientes detenidos. No certificar ni activar aforo.
La corrección está publicada sólo para PRB10A, versión `32ca2bfcb84341feaed59b2be75b5554`;
su piloto protegido pasó 16/16 rangos y renovación/liberación a cero.

El timer independiente retiró realmente los siete generadores y verificó sus
ausencias; permanecen los tres servidores permanentes. Timer deshabilitado sólo
después de comprobar cero, clave del codificador retirada, clave Vultr revocada,
API/lista previa restauradas y sesión temporal Wrangler cerrada. Tanda nueva:
US$1,05 observados de US$3 adicionales autorizados; acumulado histórico US$17,57,
sin borrar el exceso anterior de US$10,52. Factura final, impuestos y uso de
Cloudflare aparte. No quedan generadores disponibles para reutilizar.

Estado del 18 de octubre de 2026: pausa/reversión y 10.000 admisiones HTTP aprobadas en laboratorio con imágenes reales y Redis. La sustitución manual de Egress pasó también con un receptor que permaneció abierto y recuperó audio/video en 38,624 s; su publicador siguió conectado. Evidencia aislada y sintética: `release/encoder-recovery-continuous-20261018.json`. La carga pública sostenida sigue fallida. Recuperación automática y dispositivos físicos siguen pendientes. `capacityCertified:false`. La reserva actual es manual. Este documento no activa 10.000 ni 500.000 y no certifica capacidad.

## Observación sin cambiar servicios

El comando `node scripts/monitor-broadcast.cjs --room JNTUBY` consulta por HTTPS únicamente `/api/status`, `/api/rooms/JNTUBY/broadcast` y `/api/rooms/JNTUBY`. Produce una línea JSON con códigos HTTP, estado de Egress, disponibilidad del aforo y número agregado de sesiones cuando la sala es CDN. No imprime el nombre del usuario, errores originales, URL HLS, tokens ni cuerpos de respuesta. No abre `.env`, credenciales ni registros del servidor.

Sin URL privada informa `privatePlaybackUnchecked:true`; sin acceso local a salud informa `encoderLoopbackUnchecked:true`. Las sesiones que todavía no puede medir quedan `null`, nunca cero inventado. El modo `interactive` queda visible como advertencia: un monitor saludable no activa el modo masivo.

En el host del codificador puede agregarse:

```sh
node scripts/monitor-broadcast.cjs --room JNTUBY --encoder-health-url http://127.0.0.1:8081/
```

La petición a `8081` es exclusivamente `HEAD`; destruye la respuesta sin leer su cuerpo. Ese cuerpo puede incluir credenciales de un trabajo activo. No usar `curl` que lo imprima ni copiarlo a un expediente.

Para observar el HLS protegido, el operador puede suministrar `--playback-url-file /run/qsession/playback-monitor.url`. Requiere Linux, archivo regular absoluto con extensión `.url`, propietario `root:root`, modo `0600`, máximo 4096 bytes; no acepta enlaces simbólicos. El archivo se prepara mediante el flujo autorizado dentro del servidor, sin pegar la URL ni el token en comandos, chat o registros. Su contenido tiene que ser una URL HTTPS del Worker `live.qsession.org` o del hostname anterior `qsession-live.patriciomoyano11.workers.dev`, del prefijo exacto de la sala, con un único parámetro `qsat`. La herramienta mantiene esa autorización sólo en memoria, no emite ni renueva una entrada por su cuenta y no modifica el archivo. Los GET de reproducción pueden renovar la sesión existente a través del control normal de aforo.

Con ese archivo, toma dos muestras del manifiesto separadas por ocho segundos, comprueba su cronología y cambio del último segmento. No descarga ni decodifica canciones o video. Un cambio no observado queda como evidencia incompleta; un manifiesto viejo o inválido genera incidencia. La prueba no mide buffering, calidad perceptiva ni reproducción en dispositivos físicos.

También puede evaluar un snapshot agregado con `--snapshot-file archivo.json`. El esquema permite sólo números, booleanos y campos explícitos de salud, edad/progreso del manifiesto, contador y estado Redis. Se rechazan campos adicionales; nunca usar una salida cruda de Egress o un archivo de tokens como snapshot.

Umbrales predeterminados:

| Medición | Umbral o resultado |
| --- | --- |
| Snapshot agregado | Más de 45 s o reloj adelantado más de 5 s: incidencia |
| Manifiesto en emisión | Más de 24 s o edad desconocida: incidencia |
| Progreso del snapshot | Más de 30 s o desconocido: incidencia |
| Redis/contador | No disponible: incidencia; sesiones desconocidas permanecen `null` |
| Aforo | Desde 90%: advertencia; por encima del límite: incidencia |
| URL privada ausente | `privatePlaybackUnchecked:true`, advertencia |
| Salud loopback sin consultar | `encoderLoopbackUnchecked:true`, advertencia |

Códigos Unix: `0` sin alertas; `1` alertas o comprobaciones incompletas; `2` entrada inválida. Los errores de entrada también son JSON genérico, sin excepciones ni datos originales. La salida no contiene notificaciones externas ni ejecuta acciones de recuperación. Se puede revisar manualmente o integrar después con un recolector local. Su instalación periódica, retención de evidencias y entrega comprobada de avisos están pendientes; no constituyen un sistema de alertas ya instalado.

Autoprueba, sin red, recursos ni costes:

```sh
node scripts/monitor-broadcast.cjs --self-test
```

Comprueba señal saludable sintética, manifiesto detenido, caída Redis y exceso de aforo. Las pruebas automatizadas también comprueban que `HEAD 8081` nunca acceda al cuerpo, que el JSON no incluya tokens y que los datos desconocidos no se conviertan en éxito. Estas autopruebas no son evidencias de caída real ni de capacidad.

## Ensayo aislado de cambio de codificador

Antes de ensayar, el operador necesita una sala técnica, publicador sintético, Redis y credenciales de LiveKit de prueba independientes de producción, más dos procesos Egress del mismo perfil. Si los recursos de prueba no existen, preparar ese entorno antes de ejecutar la caída. No usar el Redis de producción para dos codificadores de ensayo: podrían competir por trabajos reales. No levantar el Egress antiguo sobre el VPS compartido mientras transmite el DJ para simular una reserva probada. No se autoriza aquí comprar recursos adicionales; cualquier cómputo temporal debe permanecer dentro del presupuesto ya aprobado y tener retirada al finalizar.

1. Registrar identificador de ensayo, sala técnica, generación, imágenes exactas, perfil, recursos y objetivo de recuperación aceptado antes de empezar. Mantener JNTUBY y el publicador real fuera de ese alcance.
2. Publicar un patrón 720p/30 y tono sintéticos en el LiveKit aislado. Iniciar su Egress A y comprobar manifiesto fresco, segmentos únicos, sonido y reproducción en clientes de prueba. Guardar sólo mediciones redactadas.
3. Con el publicador sintético todavía conectado, detener únicamente el proceso A de ese entorno. Registrar el momento y comprobar que el monitor observa pérdida o detención del manifiesto. No detener un contenedor de producción ni el túnel real.
4. Comprobar el estado terminal del trabajo A. Iniciar explícitamente un trabajo sustituto en B con los mismos tracks sintéticos y nuevos nombres de segmentos. La lógica actual no demuestra que esa sustitución se ejecute automáticamente.
5. Medir tiempo hasta manifiesto fresco y recuperación efectiva en Windows, web y Android. Comprobar que un reinicio de secuencia/timestamps no deje el reproductor bloqueado; los nombres únicos evitan contenido cacheado anterior, pero no prueban por sí solos continuidad del decodificador. Registrar interrupción de audio/video, reintentos y necesidad de intervención.
6. Comprobar que ninguna recuperación conecta oyentes al SFU, crea entradas extra o pierde el aforo. Si se necesita recargar HLS, conservar y validar la misma admisión en el flujo de prueba.
7. Detener y retirar únicamente los procesos y recursos creados para ese identificador. Conservar informe con métricas, errores y límites; si un cliente no recupera, el ensayo queda pendiente o fallido.

Un túnel con `Restart=always` y Docker con `unless-stopped` recuperan procesos. No restauran por sí solos un trabajo HLS, ni convierten el codificador antiguo en respaldo validado.

## Ensayo aislado de pausa y reversión

1. Preparar en el mismo entorno técnico la versión candidata y una imagen anterior que conserve HLS exclusivo, `qsat`, renovación de sesiones y control de aforo. Verificar que ambas imágenes existen. Validar Compose con `docker compose ... config --quiet`; no imprimir `config` completo porque expande secretos.
2. Abrir dos oyentes sintéticos admitidos y observar su reproducción. Aplicar `QSESSION_CDN_ONLY_PAUSED=true` sólo en el entorno técnico y recrear únicamente su app con `--no-deps`; mantener LiveKit, Egress y Redis de prueba activos.
3. Comprobar que una nueva admisión recibe `503` con `Retry-After`, sin token SFU; los oyentes ya admitidos deben continuar renovando y reproduciendo. Si no lo hacen, registrar fallo y corregir antes de aprobar la reversión.
4. Sustituir sólo la app técnica por la imagen de reversión y comprobar estado, mismo DJ técnico, manifiesto, permisos de escucha, contador y tokens existentes. No bajar el evento a `interactive` ni volver a una imagen sin aforo mientras queden oyentes.
5. Restaurar la candidata y reabrir las admisiones gradualmente en el ensayo. Verificar recuperación y que no se reutilicen plazas extra al reconectar.
6. Registrar tiempos, compatibilidad y resultado real. Un backup o un bloque `except` que restaure Compose no equivale a una reversión ensayada.

Antes de aplicar una reversión real al evento se necesita este resultado y una ventana operativa adecuada. El cierre de evento y cualquier pausa de la fuente del DJ requieren coordinación con el usuario. Las pruebas físicas de bloqueo Android, pérdida de red y retorno de cámara/audio siguen necesitando el dispositivo real.

## Evidencia y avisos pendientes

Los informes deben indicar fecha, versión, sala/generación, señal sintética o real, duración observada, clientes efectivamente probados, resultado, tiempos y `capacityCertified:false`. No copiar respuestas de `8081`, variables de entorno, claves, URL HLS ni tokens. Registrar sólo agregados.

El aviso mensual de Cloudflare de US$10 está activado y el usuario confirmó el correo de prueba. Es un aviso, no un límite de gasto. Las de reproducción necesitan una fuente periódica de mediciones y prueba de aviso. Este monitor local no envía correo, mensajes ni notificaciones y no modifica ajustes de esos proveedores.

## Evidencias de ensayos ejecutados

- `release/admissions-rollback-rehearsal-20261018.json`: v4 → v2 → v4 con Redis privado. Nuevos ingresos 503 durante pausa, concesiones anteriores válidas, 10.000 admisiones HTTP en 29,998 s y siguiente 429. Cero consultas o credenciales SFU; plan comercial y archivo de estado preservados. No abrió videos ni valida latencia pública.
- `release/encoder-recovery-rehearsal-20261018.json`: imágenes exactas, patrón/tono sintéticos y red interna sin puertos públicos. Caída de A, detección a los 17,196 s, reemplazo manual B y decodificación nueva a los 31,434 s. Fuente conectada. No probó failover automático ni continuidad del reproductor existente.
- `release/hls-10000-distributed-20261018.json`: no aprobada, pico coincidente 9.997 y retos HTML 403. Repetir con dominio de producción y sin relajar criterios.
- Cero servidores temporales restantes; cómputo observado US$1,40 acumulado, sujeto a factura final, frente al límite US$5. El saldo debe conservarse para una eventual repetición.

Cloudflare Free/importación DNS fue autorizado sin cambiar los servidores activos de GoDaddy. La activación requiere revisión del inventario completo y autorización separada. El escaneo inicial omitió correo y TURN: no activar esa copia incompleta. El aviso de consumo ya recibido no sustituye las alertas de reproducción pendientes.

Reconciliación DNS concluida: se compararon las dos páginas de GoDaddy (12 registros, incluidos NS/SOA del proveedor) con los nueve registros configurables de la zona Cloudflare pendiente. Tipo, nombre, contenido y TTL coinciden en los nueve; todos son DNS only. GoDaddy muestra DNSSEC habilitado y dos DS, pero la consulta pública recursiva no devolvió DS y la consulta directa al padre fue rechazada; verificar el traspaso antes de cualquier cambio de nameservers. DNSSEC no se modificó. Posteriormente el usuario autorizó la migración y el traspaso de DNSSEC; ver la actualización siguiente. Evidencia: `release/cloudflare-zone-preparation-20261018.json`.

## Migración autorizada y comprobación DNSSEC en curso

El usuario autorizó cambiar a `cash.ns.cloudflare.com` y `frida.ns.cloudflare.com`, retirar temporalmente DNSSEC de GoDaddy y restablecerlo con Cloudflare. Completó el código de identidad del registrador. GoDaddy confirmó los nuevos NS; se verificaron los nueve registros originales y sus TTL directamente en ambos DNS de Cloudflare (18/18 consultas). Se vinculó `live.qsession.org` al Worker existente, sin cambiar el aforo del evento ni el hostname configurado en la aplicación de producción.

La consulta inicial de DS con Resolve-DnsName local fue insuficiente: no mostró los DS que todavía publicaba el registro .org. Se observó SERVFAIL con DNSKEY Missing cuando los NS nuevos llegaron al padre y los DS antiguos continuaban allí. Se guardó el DS correcto de Cloudflare en GoDaddy (tag 2371, algoritmo 13, digest type 2); hasta comprobarlo en el padre y en resolutores validantes, el incidente queda abierto. No confundir «Success» del panel de firma de Cloudflare con validación pública de la cadena. Ver `release/cloudflare-dns-migration-20261018.json` y las consultas DNS de propagación. No repetir carga ni activar 10.000 mientras DNS/TLS no estén correctos.

Las herramientas de carga y monitor admiten sólo los dos hostnames propios explícitos, sin redirecciones ni relajación de certificados, tokens, prefijo técnico o criterios de concurrencia. El inventario conserva el hostname seleccionado; se rechazan generadores ya retirados antes de SSH. Aprobaron 13 pruebas Python y 12 de monitor Node, además de sintaxis. Esto prepara la repetición; no ejecuta ni aprueba carga sobre el nuevo dominio.

## Cierre de la migración DNS

La migración y el traspaso de DNSSEC quedaron autorizados y se completaron. La comprobación final de las 01:05:55 UTC del 19 (20:05 del 18 en Colombia) confirma DS correcto en dos servidores .org y respuestas A/DNSKEY autenticadas por Google y Cloudflare. La API responde GET 200 y live.qsession.org tiene TLS válido con DNS público normal. La petición técnica sin admisión recibe 403 sin reto cf-mitigated. El incidente SERVFAIL descrito antes está resuelto; los informes conservan su causa y la corrección. No se contrató otro plan DNS ni se cambió el aforo. La URL de reproducción de la aplicación todavía no se trasladó al nuevo hostname. Ver release/dnssec-public-validation-20261018.json y release/cloudflare-dns-migration-20261018.json.

No confundir este cierre con prueba de carga aprobada. PRB10A caducó y debe renovarse para el siguiente piloto; la sala objetivo también se está confirmando porque JNTUBY está sin emisión y se detectó una solicitud Egress en 5JZGUH. No trasladar el permiso del evento a otra sala sin la respuesta del usuario.

## Cierre de verificación del 18 de octubre: sala correcta y cliente de carga

La sala confirmada finalmente por el usuario es DKTLF3. Se comprobó su ID `room_53bd8f8b-aff9-4625-8e8e-9f679d08e423`, sus pistas de audio/cámara y Egress activo. El permiso preparado sustituyó los permisos previos de JNTUBY y 5JZGUH; caduca el 20 a las 01:39:20 UTC. No amplía todavía el aforo efectivo: modo interactive, plan comercial de 25 preservado. `release/event-DKTLF3-prepared-20261018.json`.

La carga de live.qsession.org produjo Managed Challenge por la regla HTTP DDoS `0a07c24f3cd44a57a5c19b73d2f294d7`, cuya descripción es “HTTP requests trying to impersonate browsers.” El cliente se anunciaba como `Mozilla/5.0 QSessionAuthorizedSyntheticLoad/2.0`. Se retiró Mozilla y se identificó como `QSessionAuthorizedSyntheticLoad/2.1`. No se guardó ninguna excepción ni se redujo la protección de Cloudflare. El piloto corregido pasó; la siguiente carga no tuvo 403, pero sí un 502 y muestras incompletas. No se aprobó ese resultado.

Se corrigió la deriva acumulada del muestreo: observaciones reales en plazos absolutos cada 2 s, sin inventar las muestras perdidas. La saturación por proceso ahora se compara con la cuota de núcleos de los cuatro procesos de la VM, usando sus ocho CPU verificadas; el umbral del sistema completo permanece al 90 %. Se conservan los informes originales y sus fallos. Aprobaron 31 pruebas locales (15 HLS, 4 renovación, 12 monitor).

Una muestra real de DKTLF3 se decodificó en live.qsession.org con TLS verificado: 63 cuadros de video H.264 1280×720 y 97 cuadros AAC estéreo/48 kHz. No fue una prueba de la ruta masiva protegida ni de 10.000 decodificadores. `release/dktlf3-real-media-decoded-20261018.json`.
