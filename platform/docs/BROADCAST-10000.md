# Transmisión para 10.000 espectadores: estado real

## Candidato 875f4cc1 publicado; carga pendiente del limite de Vultr

El candidato `875f4cc1` esta publicado en PRB10A como version
`99718399-84e4-4c7f-8380-4fd132a9027a`. Sustituye la FIFO de 4096
aprobaciones por una tabla fija de hashes completos SHA-256 y expiraciones
absolutas: 1.310.720 bytes por isolate, manteniendo el TTL de 20 segundos.
En tres rondas locales de 10.000 leases, con cache externa descartada, las
consultas backend bajaron de 30.000 a 10.000, con 20.000 hits RAM. Pasaron
89 pruebas JavaScript y 50 de herramientas Python, ademas de workerd local
(128 cuerpos normales y 192 recuperaciones ante fallos de cache). El piloto
protegido de un cliente paso con entrega completa, rangos y renovacion.

La carga de 10.000/620 s NO se ejecuto. Vultr creo cinco generadores dedicados
y rechazo los siguientes por su limite de cuenta. El techo nominal observado
es US$1.000/mes; se envio la solicitud INV-78HQZ para US$1.200, manteniendo
30 instancias. La solicitud sigue en estado New. Este techo de despliegue
no representa una nueva cuota mensual contratada. Se agrego al preflight la
comprobacion del techo antes del primer POST de creacion; tres regresiones
verifican el rechazo del techo insuficiente.

Los cinco generadores fueron eliminados por el temporizador independiente;
quedan solo los tres servidores permanentes, saludables. La clave temporal
se elimino, se restauraron las tres IP anteriores y la API de Vultr quedo
deshabilitada. Wrangler esta revocado. El computo temporal minimo estimado
es US$1,10, sujeto a factura; el tope autorizado era US$3,50. No hay prueba
masiva aprobada ni ampliacion del aforo de una sala real.

Expediente: `release/admission-table-sustained-preparation-closeout-20261020.json`.
La siguiente tanda requiere comprobar primero el limite efectivo del proveedor
y revisar la contabilidad y autorizacion de los recursos nuevos.


## Corrección adicional de admisión publicada y piloto aprobado

Después de cerrar la tanda se preparó el candidato `43193e67`. La comprobación
de admisión ahora comparte también la lectura de Cache API, vuelve a comprobar
la aprobación RAM después de esa espera y no lanza consultas sin registrar
cuando el mapa de operaciones pendientes está lleno. Los fallos 503 comparten
un backoff de un segundo; las denegaciones 403/410 no se almacenan. Se mantienen
los plazos y el límite RAM de 4.096 aprobaciones: no se aumentaron a ciegas.

Tres regresiones fallaron contra la fuente 9017 archivada y pasaron tras la
corrección; 75 pruebas dirigidas quedaron aprobadas. En workerd local pasaron
128 respuestas completas con una sola comprobación de admisión para la lease
sintética compartida, 192 respuestas ante fallos de caché y 96 de compatibilidad.
El primer harness esperaba erróneamente dos grupos de lease; su informe se
conservó y se corrigió el fixture antes de la comprobación final. Esto no cambia
los criterios ni el resultado de la carga masiva fallida.

El cliente de laboratorio añade valores permitidos para fases de admisión y
caché y límites de cuerpos; una prueba dirigida confirmó los contadores y el
rechazo de valores arbitrarios. No se guardan tokens ni identificadores privados.
Los informes de la carga anterior conservan las limitaciones de su instrumentación.

El candidato se publicó únicamente en PRB10A como versión
`2cc2e45e-aeaf-4e08-9cd5-6ff813e1713b`, con autorización nueva
`call_ee5fa2738f3b4373b8ec88731623c351`. La revisión automática había rechazado
reutilizar el permiso anterior para esta fuente distinta; esa condición se resolvió
con la confirmación explícita del usuario. Se verificaron fuente y siete enlaces
antes y después del piloto protegido. El piloto de un cliente pasó entrega completa,
rangos, admisión y limpieza; Wrangler quedó revocado. No se necesitó otra renovación
de PRB10A ni reiniciar la API. Vultr permaneció cerrado y no se crearon generadores.

Expediente actual: `release/admission-coalescing-closeout-20261020.json`.
**Esta versión no se ha probado a 10.000.** La prueba masiva anterior corresponde
a 9017 y sigue fallida; no se reutilizó su autorización para otra carga ni se amplió
el aforo de una sala real. Las expulsiones de aprobaciones y el solapamiento de
reintentos del backend todavía requieren medición bajo carga, junto con el margen
de los generadores y su red.

## Resultado de la nueva carga: fallida y recursos retirados

La ejecución `qsession-load-20261020-7eaee2b2`, autorizada por
`call_3df9e63a99e44a099cadb98eff4cd410`, probó la fuente `9017a99a` publicada
como `ec60955e-20f8-4c4f-9be6-502bd764c934`. Se mantuvieron 10.000 clientes,
620 s de hold y reconexión a 240 s; no hubo otra ejecución ni cambio de criterios.

De 56 procesos, cuatro terminaron entre 24 y 28 s por saturación del generador;
los otros 52 llegaron a 650 s. Ningún proceso aprobó su comprobación completa
de entrega. Hubo 43.493 HTTP 503, 6 HTTP 502, 9.010 errores de transporte y
8.492 segmentos incompletos. Se recibieron 713.743 segmentos completos.
No se demostró ningún tramo común completo para 10.000. El pico de 9.189
de las muestras parciales solo cubre 52 procesos y no certifica el aforo.

Se registraron 903 de 1.008 reconexiones esperadas. La marca anterior
`edge-not-retained` no apareció en los contadores instrumentados; eso no prueba
ausencia de todos los fallos de caché. El cliente probado no recogía todavía
`Cache-Phase` ni los nuevos límites de cuerpos. Entre los 503 se identificaron
36.142 errores de comprobación de admisión. Los plazos de llenado incluyen
caché, cola y almacenamiento: no permiten atribuir el resto exclusivamente a R2.
La saturación del laboratorio y los errores HTTP coexistieron; no hay una causa
única demostrada. Tampoco se estableció margen de red de los generadores.

Se preservaron las métricas del observador, se limpiaron concesiones, objetos
y archivos privados y se detuvo únicamente el origen sintético de la ejecución.
El temporizador independiente eliminó los siete UUID. Se comprobaron sus
ausencias y los tres servidores permanentes; después se retiraron clave y scope
del codificador. Se restauraron ambas IP originales, se quitó la del codificador
y se deshabilitó la API de Vultr, revocando todas sus claves. Wrangler ya estaba
revocado. La API de QSession respondió 200, con imagen y dos trabajos de medios
sin cambios. La reserva fue US$2,10 adicionales; la factura final no está verificada.

Expediente: `release/edge-r2-recovery-sustained-closeout-20261020.json` y
`release/edge-r2-recovery-result-analysis-20261020.json`. La fuente exacta probada
se conserva en `release/edge-r2-recovery-failed-source-20261020.js`.
**El aforo de 10.000 sigue sin validarse y no se amplió una sala real.**

## Corrección publicada y piloto aprobado: 20 de octubre

El candidato `9017a99a7a01a09a2b714c8a8e6629dd3d08fa407d74a1d098f3a5e120633210`
elimina la dependencia de que Cache API conserve cada escritura. Comparte una
lectura del objeto, verifica su tamaño completo y entrega cuerpos independientes
desde un Blob limitado en memoria. La escritura de caché pasa a ser opcional.
Se conservan admisión, caducidad, rangos y el alcance exclusivo de PRB10A.
No se convierte un fallo real o un cuerpo incompleto de R2 en una respuesta válida.

Se reprodujeron tres errores del candidato anterior antes de corregirlo:
escritura descartada, escritura rechazada y rango no disponible desde caché.
Ahora pasan 85 pruebas dirigidas y siete del cliente. En workerd local pasaron
128 respuestas completas normales, 192 respuestas completas ante tres fallos
de caché (una lectura R2 por escenario) y 96 respuestas de compatibilidad con
la ruta compartida. Se comprobaron límites de reservas y lectores, cancelación,
tokens, rangos y respuestas incompletas. Los datos locales no miden rendimiento
global ni certifican 10.000 espectadores.

También se reparó el cierre anticipado del laboratorio: el observador conserva
sus muestras, los errores de cierre no omiten la limpieza y el origen acepta
una parada cooperativa exclusivamente para su propio `runId`. Estos cambios
deben actualizarse en el codificador antes de otra carga.

La reparación se publicó únicamente en PRB10A como versión
`ec60955e-20f8-4c4f-9be6-502bd764c934`. Se verificaron la fuente y los siete
enlaces antes y después del piloto protegido. El piloto pasó entrega completa,
rangos, admisión y limpieza; Wrangler quedó revocado. Hay 153 pruebas locales
únicas aprobadas, incluida la protección de la autorización agrupada.

La nueva autorización `call_3df9e63a99e44a099cadb98eff4cd410` permite una sola
ejecución de 10.000 durante 620 s, con reconexiones, hasta siete generadores y
US$2,10 adicionales de cómputo. Los siete se crearon después de pasar el piloto
y de armar el temporizador independiente. La prueba terminó fallida y los
recursos quedaron retirados, según el resultado documentado arriba.
La evidencia nueva usa `release/edge-r2-recovery-*`;
la carga fallida y sus cierres anteriores se conservan intactos.
`capacityCertified:false` continúa vigente.

## Última carga fallida y recursos cerrados: 20 de octubre, 17:57 UTC

La única ejecución autorizada por `call_2caf9cd1c0234d28816e9c766bf72935`
usó siete generadores con ocho CPU verificadas y ocho procesos cada uno. Se
conservaron el objetivo de 10.000, el hold de 620 s y la reconexión a 240 s.
Los 56 procesos finalizaron por `persistent_request_errors` entre 26,024 y
28,213 s, antes de completar la rampa de 30 s. **El hold y las reconexiones
no llegaron a probarse.** No se relajaron criterios ni se repitió la carga.

El pico alineado fue de 7.676 clientes con fragmentos recientes, con cero
segundos comunes de entrega a los 10.000. Se registraron 10.021 HTTP 503 de
segmentos con `edge-not-retained` / `cacheFill_failed`, además de timeouts y
un fallo de conexión. Esa marca agrupa varios fallos de lectura o validación
de caché; no demuestra por sí sola un descarte de escritura o una evicción.
Parte de los generadores mostró CPU steal, mientras otros también fallaron
con escasa contención. No se verificó margen de enlace de red.

Tras terminar todos los generadores se canceló únicamente el origen sintético,
que limpió sus objetos. Se verificaron cero concesiones y archivos privados
retirados. El temporizador independiente eliminó los siete UUID; se comprobaron
sus ausencias y los tres servidores permanentes antes de retirar clave y
alcance del codificador. La clave temporal de Vultr fue revocada, se restauraron
217.138.213.4/32 y 159.26.100.230/32, se retiró 45.77.192.82/32 y se deshabilitó
la API de la organización. QSession respondió 200 y conservó los identificadores
de los trabajos del DJ. La reserva nueva fue US$2,10; la factura final no está
verificada y no debe confundirse la reserva con el cargo definitivo.

Expediente de cierre: `release/edge-r2-sustained-closeout-20261020.json`, que
enlaza con hashes los informes originales, retiro, cierre de acceso y salud.
La versión probada sigue siendo `e2aaf9e0-bda0-4dc8-b741-20740bf9aa63`, fuente
`ad2912eed16a285d0f5e6dcaef4762e23f5d9bb6fbbed8a3ed076c0aa2483858`.
**10.000 continúa sin validarse; `capacityCertified:false`.** La prueba sintética
usó video 720p a 1.600 kb/s y AAC a 128 kb/s; tampoco certifica decodificación
en dispositivos, chat o voz a esa escala. No se cambió el aforo de 9HFHXE en
esta tarea. El próximo diagnóstico debe distinguir la fase de caché que falla
antes de justificar otra carga pagada.

## Canario publicado y piloto protegido aprobado: 20 de octubre, 17:10 UTC

Se publicó `qsession-live` versión `e2aaf9e0-bda0-4dc8-b741-20740bf9aa63`,
fuente `ad2912eed16a285d0f5e6dcaef4762e23f5d9bb6fbbed8a3ed076c0aa2483858`.
La ruta nueva queda limitada a PRB10A y se conservaron exactamente los seis
enlaces previos y el namespace/clase privados. La verificación inicial de
publicación quedó incierta porque `/settings` omite las declaraciones de
ciclo de vida. Se resolvió por lectura de fuente, namespace, enlaces y versión;
no se repitió la escritura del Worker para resolver ese resultado.

El primer piloto entregó seis segmentos completos, pero el cliente no guardaba
la etiqueta `r2-edge`. Se conservó su expediente y se corrigió únicamente la
lista permitida de diagnósticos. La comprobación final, siempre con un cliente,
registró 13 manifiestos y cinco segmentos completos por `r2-edge`, 7.158.100
bytes de segmentos, cero errores y ningún segmento incompleto o superior a 6 s.
Los 16 rangos nativos fueron correctos. Se rechazó acceso sin token incluso
con caché caliente; se verificó renovación y acceso posterior a 20 s. No se
relajaron los criterios de entrega. Son unos 29 s de comprobación HTTP, no una
prueba sostenida de 10.000 ni una prueba de decodificación del canario.

La renovación de PRB10A tuvo respaldo propio y mantuvo imagen y trabajos de
video; LiveKit y el codificador no se reiniciaron. El piloto limpió origen,
concesión y archivos privados. Wrangler fue revocado mediante logout oficial;
no se crearon servidores ni se reabrió la API de Vultr. El cliente y las
herramientas previas permanecen respaldados. Tras la corrección de telemetría
pasaron 122 pruebas Python; siguen vigentes las 124 JavaScript de la misma
fuente de Worker: 246 comprobaciones locales.

La sala real indicada por el usuario es ahora **9HFHXE**. Una muestra breve
decodificó 63 cuadros de video H.264 a 1280×720 y 97 de audio AAC estéreo a
48 kHz; su ruta masiva protegida no se probó y su aforo no se cambió.

Expedientes: `release/edge-r2-pilot-20261020.json`,
`release/edge-r2-publication-20261020.json`,
`release/edge-r2-wrangler-closed-20261020.json` y
`release/9hfhxe-live-media-20261020.json`. La preparación técnica para planificar
otra carga pasaba su control en ese cierre, antes de la tanda fallida descrita
arriba. **`capacityCertified:false`**. Faltan carga
sostenida autorizada y comprobaciones de continuidad en dispositivos. Los
cambios locales de recuperación de la aplicación todavía deben publicarse.

## Preparación local del 20 de octubre, posterior al cierre

El usuario pidió corregir a fondo antes de otra carga. Se implementó un canario
de caché por borde y R2 exclusivo de PRB10A que evita el actor para índices y
segmentos, conserva admisión y comparte lecturas limitadas. También se corrigió
la doble consulta tras fallar un llenado de la ruta anterior. Esta corrección
no demuestra que todos los cuerpos truncados tuvieran la misma causa.

El generador admite ahora ocho procesos explícitos en una máquina con ocho CPU
verificadas, afinidad y cuotas observables; el valor histórico sigue siendo
cuatro. Se conservan 10.000 clientes, 620 segundos, reconexiones y los mismos
criterios de continuidad. Se verifican hashes del cliente subido antes de leer
concesiones y se registran colas, DNS, creación de conexión, cabeceras y cuerpo.
TCP y TLS separados se indican como no observables; una NIC sin capacidad
conocida no se presenta como margen de ancho de banda verificado.

La recuperación del oyente CDN preserva la reproducción nativa mientras espera
una concesión nueva válida; ignora respuestas tardías de otra sala y mantiene
el gesto explícito cuando el navegador bloquea autoplay. Son cambios locales
de la aplicación compartida, pendientes de publicar y comprobar en dispositivos.

Los comandos de preparar acceso, contratar y ejecutar otra tanda quedan
bloqueados hasta que la fuente exacta probada esté publicada y un cliente
protegido verifique cuerpos completos, admisión, limpieza y cierre de Wrangler.
La propuesta y los expedientes anteriores no autorizan nuevos recursos.
El control mantiene `capacityCertified:false` incluso después de ese piloto.

Evidencia consolidada: `release/edge-r2-validation-20261020.json` y
`release/edge-r2-workerd-local-20261020.json`: 124 pruebas JavaScript y
115 Python aprobadas, sin omisiones; 96 respuestas completas en cada ruta
local y nueve fallos controlados. Se comprobó aiohttp 3.14.5 real sobre
localhost. En ese momento todavía no se había publicado la corrección. La
publicación y el piloto posteriores se documentan arriba. Antes de activar aforo comercial faltan
el piloto remoto, la carga sostenida autorizada y la comprobación audiovisual
real de Windows, Chrome y Android, incluyendo bloqueo y reconexión.

## Cierre de la repetición de 10.000 del 20 de octubre

La tanda autorizada por `call_6a51aee29d5f4d36a5bcedd4d0a61a3f` sí se ejecutó:
siete generadores, una ejecución de 620 s con reconexiones. Falló: 10.000 plazas
admitidas, pico de 9.096 receptores recientes, ningún tramo común completo,
1.444 respuestas 503 `shared-overloaded`, 1.366 segmentos incompletos y 6.327
segmentos que tardaron más de 6 s. Un generador dejó de sostener sus procesos
al comienzo; también hubo fallos de entrega en los otros seis.

El timer independiente eliminó los siete temporales a las 05:10 UTC del 20
(00:10 de Colombia). Se limpiaron objetos técnicos, concesiones y archivos;
la clave del proveedor fue revocada, la lista anterior restaurada y la API
deshabilitada. Los tres permanentes estaban saludables al cerrar la tanda.
US$2,10 es la reserva aprobada, no un cargo final verificado. Se conservaron
los costes y resultados anteriores. Expediente:
`release/full-media-repeat-closeout-20261020.json`.

El usuario detuvo las pruebas y después solicitó un análisis para repetirlas
con cambios. No hay autorización nueva de carga, presupuesto ni acceso. La
revisión identifica una amplificación posible después de un llenado fallido:
se pierde su causa y se vuelve a consultar el actor; no explica por sí sola
cada descarga incompleta. La preparación local posterior aparece arriba;
la validación remota de esa corrección sigue pendiente.
No habilitar todavía aforo comercial de 10.000.

Actualizado el 19 de octubre de 2026, hora de Colombia. `capacityCertified:false`. No anunciar todavía 10.000 reproducciones sostenidas. El modo de 500.000 sigue desactivado.

## Diagnóstico más reciente: 1.000 aprobado; 1.500 falla continuidad

Con autorización `call_608884c01a19419ca569a6f699db999a` se creó un solo
generador, con tope adicional de US$0,30. Se ejecutaron exactamente las dos
pruebas previstas. La de 1.000 pasó: 12.929 segmentos completos, cero errores
HTTP, cero segmentos incompletos o superiores a 6 s, y limpieza completa.
La de 1.500 entregó 19.786 segmentos completos con esos mismos contadores a
cero, pero una muestra estable tuvo sólo 1.484 receptores recientes; su tramo
común completo fue 48 s frente a los 50 s exigidos. Se conserva como fallida.
No es una explicación de los cuerpos truncados de la prueba anterior de 10.000.

El timer independiente eliminó el generador a las 04:47 UTC del 20 (23:47 del
19 en Colombia). Los tres permanentes siguen saludables. Se verificó ausencia,
se retiraron los archivos privados, se revocó la clave de Vultr, se restauró
217.138.213.4/32, se retiró el permiso del codificador y la API quedó deshabilitada.
Expediente: `release/media-diagnostic-closeout-20261020.json`. Los US$0,30
son la reserva autorizada; el cargo final de esta tanda todavía no se verificó.

El usuario solicitó otra prueba de 10.000 después de iniciar el diagnóstico.
Está preparada una propuesta nueva, todavía sin autorizar ni contratar:
`release/full-media-repeat-proposal-20261020.json`. Prevé una sola ejecución,
siete generadores, 620 s de mantenimiento, reconexiones a partir del segundo
240 y una reserva adicional de US$2,10. La herramienta impide repetir la
ejecución, reducir clientes/duración, eliminar reconexiones o reutilizar el
presupuesto del diagnóstico. No cambia los criterios ni el aforo comercial.

## Repetición anterior del 19 de octubre: dos confirmaciones aprobadas, 10.000 fallida

Diagnóstico por etapas publicado con autorización `call_ee42755e79394eebbfcff07af67dda45`,
versión `2c930d8422f44775a21e4a82c1d29903`; expediente
`release/media-diagnostics-closeout-20261020.json`. Manifest en
`release/media-diagnostics-manifest-20261020.json`, fuente `6cfcc2de8768347282d3129b17dd778e68c45cf9a3b020ee70b1a54cbde2050f`.
Distingue lectura de R2, lectura de cuerpo, tamaño/integridad, colas, llamada al
actor y rechazo tardío del stream. Sólo registra códigos constantes, como máximo
uno por código cada 30 s por isolate, sin claves de objeto, tokens ni excepciones.
El cliente conserva los códigos permitidos y la capa de caché en el informe.
Cancelación del stream es una observación; no demuestra por sí sola un fallo.

Pasaron 51 pruebas Node, 44 Python y cuatro guardas de publicación (API falsa).
En workerd local: 96 solicitudes, 86 cuerpos completos, diez cancelaciones
intencionales, rechazo sin autorización y seis casos de fallos simulados aprobados.
Runtime local detenido. Fuente y seis enlaces verificados tras publicar.
El publicador exige aprobación nueva registrada, fuente remota anterior exacta,
los seis enlaces intactos y la misma clase/namespace privados. Esta preparación
mejora la identificación del fallo; no es una reparación de streaming validada.
PRB10A se renovó con el reinicio breve autorizado: API 200, imagen intacta y sin
reiniciar LiveKit ni el codificador. El piloto HTTP protegido pasó 16/16 rangos,
segmento completo de 1.431.620 bytes, acceso sin autorización 403, cero errores y
renovación de la misma plaza de 27.951 ms. Limpieza de leases a cero, archivos y
objetos técnicos; identificadores de trabajos de medios sin cambios durante el
piloto. No fue reproducción decodificada ni carga sostenida.
Wrangler revocado oficialmente a las 04:21:28 UTC del 20 (23:21 del 19, Colombia),
con configuración OAuth y archivo de login pendientes retirados. Cero servidores
nuevos durante esa publicación; Vultr no se reabrió en ese paso. Estos
diagnósticos no prueban una reparación. Cualquier repetición posterior requiere
alcance y presupuesto nuevos y debe conservar el resultado aunque sea fallido.

Expediente actual: `release/repeat-load-closeout-20261020.json` (fecha UTC).
Autorización `call_e77e9c943d8d451284e41f1efce02e7b`, tope de cómputo de esta
etapa US$3,60. Primero pasaron dos cargas independientes de 1.000 y su limpieza;
sólo entonces se amplió de uno a siete generadores. Worker `c21dc766` intacto.

La carga de 10.000 duró 650 s, pero su mayor ventana común de recepción completa
fue de **4 s**, frente a los 610 exigidos. Hubo 16.159 timeouts de segmentos,
84 de manifiestos, 902 respuestas 503 de segmentos y 13 de manifiestos.
Se verificaron 1.048.493 segmentos completos (1.501.043.548.660 bytes); también
11.557 respuestas incompletas y 28.186 descargas superiores a seis segundos.
De 1.008 reconexiones previstas arrancaron y recuperaron medios 996; la mayor
recuperación fue de 13.904,89 ms, superior a 12.000. **No aprobó ni habilitó aforo.**

El patrón de 1.040.384 bytes apareció en 169 primeras muestras de fallos,
incluidas respuestas 200/HIT. No atribuirlo todavía a una causa concreta.
Los generadores no registraron errores ni descartes de recepción de interfaz;
su referencia de capacidad NIC sigue desconocida. Un evento 503 de Cloudflare
tenía `outcome:ok`, 1.186 ms totales y 7 ms de CPU, sin spans disponibles.
La causa de los fallos de entrega y caché continúa sin establecer.
Una reproducción local con 256 solicitudes concurrentes se detuvo por demora
y quedó **inconclusa** (`repeat-stream-local-reproduction-20261020.json`), sin
recursos cloud ni runtime restante. Su error al detenerla no prueba el fallo
del streaming. El arnés local recibió un watchdog de 120 s y salida no cero al
fallar; sólo se comprobó su compilación, no una nueva ejecución del watchdog.

El controlador venció su espera fija antes de recoger el informe final del
publicador. Se verificó la limpieza por separado: cero objetos propios y leases.
Se corrigió **localmente** la espera respecto al cierre previsto del publicador
y la conservación de informes tardíos en `finally`; 43 pruebas HLS aprobadas.
Esto corrige el registro de cierre; no demuestra una reparación del streaming.

El timer eliminó los siete temporales; ausencia verificada a las 03:52:15 UTC.
Tres permanentes saludables. Clave remota retirada, clave Vultr revocada,
217.138.213.4/32 restaurada, 45.77.192.82/32 retirada y API deshabilitada.
La reserva fue US$2,10 nuevos + US$0,30 previos sin cargo comprobado + US$1,20
observados anteriormente = US$3,60. No presentar reservas como factura observada.
Workers/R2/Durable Objects e impuestos siguen aparte; no se añadió gasto fijo.
No queda otra ejecución masiva autorizada dentro de esta tanda.

## Ensayo anterior del 19 de octubre: detenido en la primera confirmación

Expediente vigente: `release/sustained-load-closeout-20261020.json` (fecha UTC).
Autorización `call_0178dda16f0f45d18746bba2a7b35191`; el reinicio breve de la API
durante una emisión se autorizó aparte en `call_547633da2dd44a9aaac7d08c8f5f7f09`.
PRB10A se renovó preservando imagen y aforo comercial, sin reiniciar LiveKit/Egress.

Sólo se creó un generador. La primera carga entregó 13.032 fragmentos completos,
sin fragmentos tardíos ni incompletos y con 1.000 receptores en toda la ventana
estable. Registró seis respuestas 503 `backend-timeout` al comprobar admisión,
por lo que NO aprobó. No hubo segunda confirmación ni carga de 10.000; los seis
generadores condicionales no se crearon.

Tras limpieza de leases a cero, archivos y objetos técnicos, se adelantó el
timer. El proveedor confirmó la instancia ausente a las 02:40:37 UTC. Se verificó
la eliminación independiente y los tres permanentes saludables; luego se
retiró la clave del codificador, se revocaron las claves de Vultr, se restauró
217.138.213.4/32, se retiró 45.77.192.82/32 y se deshabilitó la API. Cero temporales.

La única máquina tenía reserva de US$0,30; su cargo real todavía no se comprobó
en factura. US$1,20 previos sí estaban observados; límite nuevo US$3,30. No
presentar US$1,50 como consumo observado ni gastar de nuevo una reserva liberada
sin revisar el alcance de otra tanda. El exceso histórico de US$10,52 permanece.

Se publicó una corrección: primer intento de backend de hasta 1,75 s y un
único reintento dentro de los mismos cuatro segundos totales. Rechazos, TLS y
caducidad siguen siendo definitivos; no se crea otra plaza. Pasó 45 pruebas y
768 solicitudes del runtime local oficial. Fuente publicada
`9f6364d59898d708f64afd108cbf94d0e5f922bb599b6c61c5e1db16c0bc4534`;
versión `c21dc76605844a0b86d234ebd1d10e38`, publicada a las 03:04:28 UTC del 20
(22:04 del 19, Colombia), con autorización `call_a2f6963d39e74c4099bf385107ee0a8d`.
Hash y seis enlaces verificados por API oficial; namespace y PRB10A preservados.
El piloto protegido de un cliente pasó: 16/16 rangos completos, rechazo 403 sin
autorización, renovación de la misma plaza de 29.718 ms y liberación a cero.
Archivos técnicos retirados y trabajos de medios sin cambios. Wrangler se revocó
oficialmente a las 03:06:16 UTC. No se crearon servidores ni se reactivó Vultr.
La causa de la lentitud del backend sigue sin establecer; no se repitió carga
de 1.000 ni 10.000 con esta versión, ni se comprobó reproducción decodificada.
No amplía el aforo ni certifica capacidad. Evidencias:
`release/worker-admission-deadline-manifest-20261020.json`,
`release/hls-admission-deadline-validation-20261020.xml` y
`release/edge-cache-admission-deadline-local-20261020.json`,
`release/admission-deadline-publication-20261020.json`,
`release/admission-deadline-postpublication-20261020.json`,
`release/admission-deadline-protected-pilot-20261020.json` y
`release/admission-deadline-wrangler-session-closed-20261020.json`.

## Diseño del ensayo ejecutado parcialmente: confirmación y diez minutos sostenidos

Propuesta revisable: `release/final-10000-load-proposal-20261020.json`.
Herramientas verificadas con 56 pruebas locales. La primera etapa ya se ejecutó
y falló, según el cierre anterior. Los comandos siguientes documentan ese diseño;
no reutilizar el inventario retirado ni asumir autorización para otra tanda.

1. Renovar exclusivamente PRB10A, comprobar que no haya otra prueba ni emisión
   que vaya a interrumpirse y preservar la imagen de la app. Subir las herramientas
   revisadas al codificador. La configuración técnica requiere reiniciar la API;
   no reiniciar LiveKit ni Egress. No ampliar el aforo comercial.
2. Registrar la aprobación y armar el timer independiente de 45 minutos antes
   de crear recursos. Sólo crear un generador. Dos ensayos de 1.000, con rampa
   de 30 s y mantenimiento de 60 s, deben aprobar entrega y limpieza.
3. Guardar ambos nombres de expediente en `confirmationExecutions` del inventario.
   El aprovisionador rechaza agregar recursos si falta cualquiera de las dos
   confirmaciones o si pertenece a otro fingerprint de retirada.
4. Sólo entonces agregar seis generadores: siete en total. Ejecutar una única
   carga de 10.000, rampa de 30 s y mantenimiento de 620 s. Exigir todas las
   muestras comunes entre los segundos 38 y 648: 306 muestras, 610 s completos.
   Un pico aislado o una muestra con 9.999 no aprueba.
5. A los 240 s, cada décimo cliente por proceso cierra su conexión HTTP y abre
   otra reutilizando la misma admisión. Exigir entrega completa posterior en
   menos de 12 s y mantener el criterio de continuidad del conjunto. Esto prueba
   reinicio de sesión HTTP; no simula cambio físico de red ni bloqueo de pantalla.
6. Ante cualquier fallo, detener el avance y retirar los recursos. No repetir
   automáticamente la carga completa. Verificar cero leases, archivos privados
   retirados, objetos técnicos eliminados, instancias ausentes por API y revocar
   clave/acceso. Restaurar 217.138.213.4/32 y retirar 45.77.192.82/32 de la API.

Reserva propuesta: US$2,10 para la tanda (dos horas de US$0,15 por cada uno de
siete generadores). Con US$1,20 ya observados, el límite nuevo debe pasar de
US$3 a US$3,30: incremento solicitado US$0,30. No es una cotización vigente del
proveedor: antes de cualquier creación se comprueban plan, región y tarifa;
si supera US$0,15/h se detiene. Factura final, impuestos y Workers/R2/Durable
Objects separados. No cambia el coste fijo mensual. La salida de datos de R2
no se factura, pero sus operaciones y otros servicios pueden tener consumo:
https://developers.cloudflare.com/r2/pricing/ y
https://developers.cloudflare.com/durable-objects/platform/pricing/.

Comandos preparados, siempre con un inventario **nuevo** y aprobación real:

```powershell
python platform/scripts/prepare-retirement-scope.py --approved-sustained-proposal release/sustained-load-approval-20261020.json --inventory release/load-generators-sustained-20261020.json
python platform/scripts/install-load-retirement.py
python platform/scripts/provision-guarded-load.py --inventory release/load-generators-sustained-20261020.json --additional-generators 1
python platform/scripts/manage-guarded-load.py --inventory release/load-generators-sustained-20261020.json
python platform/scripts/prepare-load-generators.py --inventory release/load-generators-sustained-20261020.json --update-inventory
python platform/scripts/run-custom-domain-load.py --inventory release/load-generators-sustained-20261020.json --suffix sustained-1000-a-20261020 --transport aiohttp --clients 1000
python platform/scripts/run-custom-domain-load.py --inventory release/load-generators-sustained-20261020.json --suffix sustained-1000-b-20261020 --transport aiohttp --clients 1000
```

Después de verificar ambos expedientes y registrar sus nombres, agregar seis,
actualizar el inventario y preparar sus identidades SSH antes de ejecutar:

```powershell
python platform/scripts/run-custom-domain-load.py --inventory release/load-generators-sustained-20261020.json --suffix sustained-10000-20261020 --transport aiohttp --clients 10000 --hold 620 --reconnect-after 240
python platform/scripts/manage-guarded-load.py --inventory release/load-generators-sustained-20261020.json --retire-now
```

Esta tanda comprueba transporte HTTP de audio/video sintético. Después todavía
se necesitan reproducción decodificada en Windows/Chrome/Android, carga privada
combinada (persistencia, imágenes, voz), recuperación automática y avisos con
entrega comprobada. Sólo el conjunto permite decidir la activación comercial.

## Diagnóstico posterior del 19 de octubre, cierre del 20 a las 02:03 UTC

Expediente: `release/hls-diagnostic-closeout-20261020.json`. Se publicó la app
`qsession-app:qsession-20261020-private-groups-v1`: audio principal exclusivo del
DJ, grupos privados de hasta diez personas, controles de voz aislada, límites
WebSocket y recuperación HLS ampliada. Pasaron 96 comprobaciones. La prueba local
de 10.000 conexiones repartidas en 1.000 grupos pasó, con cien reconexiones;
excluye persistencia HTTP/Postgres, voz, imágenes y reproducción combinada.

El diagnóstico usó un único generador independiente y seis cargas de 1.000.
La ruta original volvió a mostrar cuerpos incompletos, con correlación CF-Ray;
HTTP/2 fue una comparación de protocolo con dieciséis pools por proceso y no
prueba de navegadores físicos. La comparación sin actor sostuvo los 1.000 en
la ventana estable, pero registró cinco errores 520 de admisión. Se restauró
`QSESSION_SHARED_CACHE_ROOM=PRB10A`; los seis enlaces y el bucket se conservaron.

Se publicó el reintento de admisión, versión `24b4772213fe4586b21a052b4f432049`,
hash `759c1ffb5fe23b1e8dcdd1a737664bba569d0b61f1b2780d7e8e82dbe75b0cc1`.
Reintenta una vez ciertos errores transitorios dentro de los cuatro segundos
originales; no reintenta denegaciones ni crea otra plaza. Pasaron 34 pruebas de
borde y acceso. La primera repetición corregida pasó: 1.000 recientes durante
la ventana completa, cero errores y fragmentos tardíos. La confirmación falló:
un 502 al procesar manifiesto, un timeout de manifiesto y mínimo reciente 999.
No registró errores 520 ni fragmentos tardíos. Esto NO certifica 10.000 ni
establece la causa completa del fallo del manifiesto. No se repitió carga masiva.

Se publicó después una recuperación de lectura del manifiesto: una lectura
fresca del mismo objeto admitido, hasta 64 KiB, con validación posterior de
caducidad y referencias. Los fallos de lectura y de referencias quedan separados.
Pasaron 39 pruebas y el runtime local oficial con 768 solicitudes, 82
cancelaciones y tres fallos simulados. Fuente publicada
`1d3e22b8d11cc620163ad790cbf55c07315abd08922a818eecf6c91b2b3ae200`.
Publicada a las 02:16:51 UTC con autorización específica
`call_ae5484f689964133ad2f4a9c30f8f04a`, versión
`61509bb6ece8466fb49ddf19594b4b7f`; los seis enlaces se verificaron por API.
El piloto protegido de un cliente pasó: 16/16 rangos completos, acceso sin
autorización rechazado, renovación de 28.525 ms y liberación a cero. Se limpiaron
los archivos privados; Wrangler se revocó oficialmente a las 02:18:22 UTC.
No se crearon servidores ni se reactivó Vultr. Esta comprobación HTTP sintética
no decodifica audio/video, no establece la causa raíz y no sustituye la repetición
de 1.000 ni la prueba audiovisual sostenida de 10.000.
Evidencias: `release/hls-manifest-recovery-validation-20261020.xml` y
`release/edge-cache-context-local-20261020.json`,
`release/manifest-recovery-publication-20261020.json`,
`release/manifest-recovery-postpublication-20261020.json`,
`release/manifest-recovery-protected-pilot-20261020.json` y
`release/manifest-recovery-wrangler-session-closed-20261020.json`.

La retirada independiente eliminó el único generador; API confirmó su ausencia
y los tres permanentes saludables. Clave del codificador retirada, Wrangler
cerrado, clave Vultr revocada, API deshabilitada, IP 217.138.213.4/32 restaurada
y 45.77.192.82/32 retirada de su lista. Cero temporales. Coste observado adicional
US$0,15; consumo observado de la autorización nueva: US$1,20 de US$3, sujeto a
factura final y separado de impuestos/Cloudflare. Histórico observado total
US$17,72, conservando el exceso previo de US$10,52 sin compensación.

DKTLF3 se comprobó a las 01:55:16 UTC: `interactive`, sin emisión y capacidad 25.
No se amplió el aforo. Faltan continuidad masiva y reconexiones, dispositivos
sobre la ruta protegida, carga privada combinada, recuperación automática y
avisos de reproducción. Evidencias de cierre: `diagnostic-retirement-verified-20261020.json`,
`diagnostic-vultr-access-closed-20261020.json`, `diagnostic-wrangler-session-closed-20261020.json`
y `diagnostic-load-observed-cost-20261020.json`, todos dentro de `release/`.

## Ensayo anterior del 19 de octubre, cierre posterior a las 19:56 de Colombia

Expediente actual: `release/broadcast-10000-closeout-20261020.json` (fecha UTC).
**La capacidad de 10.000 continúa sin certificar y no se habilitó.** Se ejecutaron
tres cargas con la misma tanda autorizada. La segunda alcanzó 10.000 receptores
recientes durante un tramo común de 8 s, pero falló la continuidad. La tercera,
con caché local del CDN delante de la caché privada, alcanzó 9.995 recientes,
registró 401 fragmentos superiores a 6 s y 40 clientes detenidos. Los 10.000
clientes de esa tercera prueba iniciaron medios; eso no equivale a mantenerlos
recibiendo simultáneamente. No reinterpretar un pico o HTTP 200 como certificación.

La caché local quedó publicada sólo para `PRB10A`, versión
`32ca2bfcb84341feaed59b2be75b5554`, conservando namespace y seis enlaces. El piloto
posterior pasó 16/16 rangos nativos, rechazó accesos sin autorización incluso
con caché caliente, renovó la concesión y la liberó a cero. Es un cliente HTTP,
sin prueba de decodificación física ni de reconexión de 10.000. Las pruebas de
carga conservan sus informes fallidos originales. No se estableció la causa
definitiva de las respuestas incompletas y timeouts; no atribuirla sólo al CDN
ni sólo al generador. La instrumentación adicional de fase de fallo y contadores
TCP antes/después está preparada localmente para un diagnóstico posterior.

El control de gasto sí se verificó realmente: el timer independiente eliminó
los siete temporales en su propio ciclo, se confirmaron sus siete 404 y quedaron
los tres permanentes funcionando. Después se deshabilitó el timer, se retiraron
clave/configuración privada del codificador, se revocó la clave en Vultr y se
restauraron la API deshabilitada y su lista previa. Wrangler cerró su sesión
temporal mediante logout oficial. No quedan máquinas temporales.

Cómputo observado de esta tanda: **US$1,05 de US$3 adicionales autorizados**,
sujeto a factura y sin impuestos ni uso de Cloudflare. Histórico anterior:
US$16,52 y exceso observado de US$10,52 sin compensación; acumulado observado
US$17,57. La nueva autorización no borra el exceso anterior.

Comprobación final pública: app/room/broadcast HTTP 200, DKTLF3 en `interactive`,
sin transmisión activa y capacidad comercial 25. Continúan pendientes entrega
sostenida, reconexiones, dispositivos sobre la ruta protegida, recuperación
automática y alertas periódicas con entrega comprobada antes de activar 10.000.

## Cierre anterior del 19 de octubre, antes del nuevo ensayo

La caché privada quedó publicada y vinculada en `qsession-live`, namespace `15dc9a3675ea409ab0c9b17a2618e4b3`, versión `0e1263e2950144d1a89de9be800f92ca`, habilitada únicamente para `PRB10A`. Se conservaron todos los enlaces y la clave de admisión; no se modificaron DNS, dominios ni exposición del bucket. El runtime local real entregó 96 respuestas correctas. El piloto protegido en Cloudflare pasó: 16 rangos simultáneos correctos, respuestas 206 con longitud exacta, rechazo 403 sin admisión incluso con caché caliente y renovación de la concesión. Terminó con cero concesiones, archivos de token eliminados y objetos sintéticos retirados. No hubo una nueva prueba masiva de 10.000 sobre esta caché. La sesión temporal de Wrangler se cerró con el comando oficial y se retiraron configuración OAuth y registros privados locales.

Los siete temporales de la última tanda **no se retiraron antes de la interrupción** y excedieron el plazo presupuestado. El 19 se observaron US$1,86 por servidor: US$13,02 en esa tanda, más US$3,50 anteriores, **US$16,52 acumulados frente a US$6 autorizados**. Exceso observado US$10,52; factura final sin confirmar y consumo Workers/R2 excluido. Todos fueron destruidos y el listado final mostró únicamente los tres servidores permanentes funcionando. No crear más generadores ni repetir carga pagada bajo esta autorización agotada. Las proyecciones previas de US$4,55/US$5,60 quedan superadas por este importe observado.

La comprobación pública posterior confirmó app saludable, `interactive`, capacidad comercial 25 en DKTLF3 y permiso de 10.000 `prepared`, todavía sin límite efectivo ampliado. Faltan carga sostenida/reconexión de la nueva caché, dispositivos sobre la ruta protegida, recuperación automática y alertas periódicas de reproducción con entrega comprobada. Informe vigente: `release/broadcast-10000-closeout-20261019.json`. Pruebas y retirada: `release/private-cache-protected-pilot-20261019.json`, `release/temporary-compute-closeout-20261019.json`, `release/temporary-generators-retired-20261019.png`.

## Publicado y contratado

Control de gasto: servicio/timer instalado, verificado y ejecutado realmente;
actualmente deshabilitado tras confirmar la retirada de toda la tanda. Accesos
temporales revocados. Pasaron 17 pruebas del control, 15 de orquestación y 7 del
transporte HTTP. La corrección de caché y admisión pasó sus 31 pruebas Node.
Detalles y límites: `LOAD-RETIREMENT.md`. Esto no modifica la certificación ni
el aforo efectivo y no sustituye la validación masiva pendiente.

- App vigente: `qsession-app:qsession-20261018-camera-clock-v4`. Aforo Redis, admisión HMAC por sesión, reanudación sin plaza extra y permiso operativo por evento. La audiencia continúa en `interactive`.
- Codificador dedicado Vultr `45.77.192.82`, 4 vCPU/8 GB, Egress v1.14.1, US$48/mes de base. Redis privado mediante túnel SSH. El codificador antiguo está detenido, `restart=no`, perfil manual `legacy-encoder`.
- Workers Paid confirmado: US$5/mes de base. Base adicional combinada US$53/mes, más consumo e impuestos. La zona DNS Free no agrega otra cuota de zona.
- R2 limitado al bucket `qsession-live` y a `104.238.137.144/32`, `45.77.192.82/32`. No copiar sus claves a informes. Nunca imprimir el cuerpo de salud del puerto 8081: consultar sólo HEAD y conservar el código.
- Perfil desplegado y ensayado: H.264 1280×720/30, video 1,6 Mb/s, AAC estéreo 128 kb/s/48 kHz, segmentos de 6 s. El ejemplo de 1,8 Mb/s/AAC 320 kb/s es otro perfil y requiere su propia validación.

El usuario confirmó finalmente **DKTLF3** tras comprobar que era la sala de su DJ. El permiso operativo para 10.000 ya está preparado para su ID exacto `room_53bd8f8b-aff9-4625-8e8e-9f679d08e423`, sustituyendo el permiso preparado de JNTUBY. Caduca el 20 de octubre a las 01:39:20 UTC (19 de octubre, 20:39 en Colombia). Sigue sin ser efectivo: la app continúa en interactive. Se conservaron los campos comerciales, imagen y trabajos de medios; sólo se reinició la API para cargar la configuración privada. Informe: `release/event-DKTLF3-prepared-20261018.json`.

## DNS y dominio de distribución: migración comprobada

El usuario autorizó primero preparar Cloudflare Free y después migrar los servidores de nombres y traspasar DNSSEC. Completó la verificación de identidad de GoDaddy. La delegación ahora usa `cash.ns.cloudflare.com` y `frida.ns.cloudflare.com`.

Se revisaron las dos páginas de GoDaddy: 12 registros, incluidos tres NS/SOA administrados por el proveedor. Los nueve registros configurables coinciden en nombre, tipo, contenido y TTL; se comprobaron directamente en ambos DNS de Cloudflare (18/18 consultas). El escaneo automático había omitido TURN y tres registros de correo, que se añadieron antes del cambio. Los nueve registros existentes permanecen DNS only. Sólo el nuevo `live.qsession.org` se vinculó al Worker `qsession-live`.

Hubo un incidente durante el traspaso: Resolve-DnsName local no mostró los DS que todavía publicaba .org; la retirada de esos DS no se había confirmado autoritativamente antes de cambiar NS. Se observó SERVFAIL con DNSKEY Missing. Los DS antiguos fueron retirados, se publicó el DS de Cloudflare y se comprobó su correspondencia criptográfica con las claves de ambos DNS. Una repetición idéntica del formulario de GoDaddy mostró un error; la publicación original acabó llegando correctamente. El incidente está resuelto en las comprobaciones realizadas, no debe ocultarse ni atribuirse a un fallo del reproductor.

Comprobación final a las 01:05:55 UTC del 19 (20:05 del 18 en Colombia): dos servidores .org publican el DS correcto (tag 2371, algoritmo 13, SHA-256); Google y Cloudflare autentican A y DNSKEY. La API responde GET 200. `live.qsession.org` tiene certificado verificado usando DNS público normal; una petición al prefijo técnico sin admisión recibe 403, sin `cf-mitigated: challenge`. Universal SSL figura activo. Esto no prueba reproducción autorizada ni carga en el dominio nuevo. La aplicación conserva por ahora su URL anterior de reproducción.

Evidencias: `release/cloudflare-zone-preparation-20261018.json`, `release/cloudflare-authoritative-records-20261018.json`, `release/cloudflare-dnssec-key-verification-20261018.json`, `release/cloudflare-dns-migration-20261018.json`, `release/dnssec-public-validation-20261018.json`.

## Resultados de pruebas y límites

| Prueba | Resultado | Alcance |
| --- | --- | --- |
| Señal técnica PRB10A | HLS 720p/30, AAC, CORS y caché MISS/HIT | Una señal sintética, no concurrencia |
| Piloto protegido live.qsession.org | 29 s; 14 manifiestos, 5 segmentos, cero errores; renovación +28,427 s y liberación a cero | Un cliente HTTP sintético; no decodificación ni carga |
| Android 0.1.42 | Usuario confirmó audio durante 3 min de bloqueo y video al volver | Ruta actual, no ruta masiva protegida |
| Windows | Segunda ventana con cámara/música durante 2 min | Ruta actual |
| Chrome incógnito v4 | Usuario confirmó cámara/música antes y después de recargar | Incidente de cámara resuelto en esa comprobación |
| HTTP + Redis reales | 10.000 admisiones en 29,998 s; siguiente 429; reanudación sin plaza extra; liberación a cero | Laboratorio, HTTP loopback, no reproducción ni latencia pública |
| Pausa/reversión v4 → v2 → v4 | Concesiones preservadas; nuevos ingresos 503 durante pausa | Imágenes reales y Redis aislado; no continuidad audiovisual |
| Reemplazo manual de Egress | Audio/video decodificados 31,434 s después de matar A e iniciar B | Patrón/tono, receptor nuevo; no failover automático ni recuperación del mismo cliente |
| Alerta mensual US$10 | Activada; usuario confirmó correo de prueba | Aviso, no tope de gasto; alertas periódicas de reproducción pendientes |

La prueba de admisiones usó preparación sintética, 2 CPU/1536 MiB, cero consultas o credenciales SFU y preservó el plan de 25 y el archivo de estado comercial. No usar ese fixture como aprobación de producción. La recuperación de Egress usó las imágenes exactas de producción, red interna sin puertos públicos y claves de laboratorio; el publicador siguió conectado. Cada receptor decodificó 120 cuadros/3,989 s. No probó continuidad de un cliente ya conectado ni dispositivos físicos.

Informes: `release/admissions-rollback-rehearsal-20261018.json`, `release/encoder-recovery-rehearsal-20261018.json`, `release/device-playback-validation-20261018.json`, `release/cloudflare-budget-alert-20261018.json`.

## Carga distribuida: intentos anteriores y repetición fallida

Se conservaron cinco intentos con siete generadores. En el último los 10.000 clientes recibieron segmentos al menos una vez, pero el pico de recepciones recientes coincidentes fue 9.997 y no se sostuvieron los 10.000 exigidos. Hubo retos HTML 403 en workers.dev y otros intentos saturaron CPU de los generadores. No se rebajaron criterios. Son clientes HTTP que descargan segmentos; no decodifican 10.000 videos ni equivalen a dispositivos físicos.

El control de aforo sí mantuvo 10.000 concesiones y rechazó el ingreso 10.001. Eso no compensa los errores audiovisuales. Informe principal: `release/hls-10000-distributed-20261018.json`; se guardaron los cinco intentos por separado.

Todos los temporales de esa sesión fueron retirados: cero generadores y cero volúmenes adicionales. Cómputo observado acumulado US$1,40, sujeto a factura final, dentro del límite US$5. Una repetición debe descontarse del mismo presupuesto; no hay otros US$5 nuevos. Inventario: `release/load-generators-active-20261018.json`.

Las herramientas ahora permiten únicamente los dos hostnames propios explícitos y conservan el seleccionado en el inventario. Los manifiestos no pueden trasladar tokens a otra procedencia; no se permiten redirecciones ni certificados sin verificar. Se rechazan generadores retirados antes de SSH. Aprobaron 19 pruebas Python (15 HLS y 4 de renovación) y 12 de monitor Node, además de sintaxis: esto prepara la repetición y no aprueba carga real. `release/custom-domain-tooling-checks-20261018.json`.

### Repetición en live.qsession.org

Se ejecutó otro ensayo con siete generadores de 8 vCPU en Chicago, Dallas y Nueva Jersey. Redis mantuvo las 10.000 concesiones, pero la entrega falló: 22.948 denegaciones HTML registradas, 386 segmentos tardaron más de 6 s y faltó el informe de un proceso. Se descargaron 47.537 segmentos (68.054.919.940 bytes) en los informes recibidos. El pico agregado cero significa que no había una muestra completa de todos los procesos, no que no se entregó audio/video. No certificar este ensayo.

Cloudflare mostró HTTP DDoS / Managed Challenge para GET del manifiesto técnico en live.qsession.org; regla `0a07c24f3cd44a57a5c19b73d2f294d7`. No se modificó la protección. No hubo saturación sostenida de CPU en los procesos con informe; no se obtuvo una referencia fiable del límite de NIC. Todos los temporales se retiraron; accesos a cero, archivos privados y objetos sintéticos eliminados. Cómputo observado acumulado US$2,45, sujeto a factura final y dentro del mismo máximo US$5. Informes: `release/custom-domain-load-review-20261018.json`, `release/hls-10000-custom-domain-20261018.json`, `release/load-generators-custom-domain-20261018.json`.

### Cierre con cliente identificado correctamente y muestreo sincronizado

La última repetición usó los mismos siete temporales de Chicago: 10.000 clientes recibieron medios, 26 muestras comunes completas y 48 s consecutivos con 10.000 recepciones recientes. Sigue FALLIDA: en la primera muestra de la ventana estable sólo había 9.931, y un proceso registró un timeout de manifiesto. No hubo 403 ni segmentos de más de 6 s. No se rebajaron los criterios para aceptar el resultado. La muestra de medios del DJ de DKTLF3 sí decodificó H.264 720p y AAC estéreo; no valida la ruta masiva protegida en dispositivos.

Se retiraron todos los temporales y sus archivos de acceso, el contador técnico quedó a cero y se eliminaron los objetos sintéticos. Cómputo acumulado observado US$3,50, sujeto a factura final y sin incluir consumo Workers/R2. La última revisión encontró DKTLF3 activa, saludable y con aforo comercial 25; su permiso 10000 está prepared y no es efectivo. Informe de cierre: `release/broadcast-10000-closeout-20261018.json`. Evidencia de retirada: `release/load-generators-final-retired-20261018.png`.

### Revisión adicional: caché y recuperación del mismo receptor

En la sesión siguiente, el mejor ensayo de entrega sostuvo 10.000 receptores HTTP recientes durante 52 s, pero falló por dos HTTP 502 de manifiesto y tres segmentos de más de 6 s. Otros ensayos se conservaron por separado; el último, sin errores HTTP, tampoco pasó porque registró doce segmentos tardíos. No son pruebas de 10.000 reproductores decodificando. La versión experimental de espera de caché se revirtió a `571f22fb`.

El ensayo aislado de recuperación continua sí pasó: el mismo proceso receptor siguió abierto, leyó los segmentos del codificador de reemplazo y volvió a decodificar audio y video a los 38,624 s. El publicador permaneció conectado. Fue sustitución manual en una red Docker interna con señal sintética e imágenes oficiales, sin imagen, credenciales ni datos de la app de producción. No prueba recuperación automática ni dispositivos físicos. Evidencia: `release/encoder-recovery-continuous-20261018.json`.

Se preparó una caché privada con 64 particiones, límite compartido de 24 MiB por isolate, objetos de hasta 8 MiB y cuatro lecturas de almacenamiento simultáneas. Aprobaron siete pruebas específicas, incluidas 300 respuestas concurrentes y cancelaciones, además de las 26 pruebas previas de admisión/borde y el dry-run oficial. Se publicó la clase sin activación (`2d70fe36`); falta registrar su namespace y enlace antes del piloto. El bucket sigue privado. Esta preparación no demuestra capacidad real. La autorización del enlace corresponde a `call_a0914e899bbf41ceb265ab70ad02a103` y se limita a `PRB10A`.

El usuario amplió el máximo acumulado de cómputo temporal a US$6 (`call_7a6df35e769a41afaaca8f49a07ded5c`). Los mismos siete temporales tienen un máximo de dos horas facturadas, proyectado acumulado US$5,60; US$4,55 era lo observado antes de la segunda hora y la factura final sigue sin confirmar. La retirada está pendiente y debe completarse antes del límite de esa segunda hora; no usar este párrafo como constancia de retirada. Inventario vivo: `release/load-generators-cache-fill-20261018.json`.

## Pendiente antes de activar 10.000

1. El piloto protegido anterior pasó y PRB10A se renovó hasta el 19 a las 03:59:21 UTC. El identificador automatizado correcto eliminó los 403 en las repeticiones; no se cambió la protección DDoS. Registrar la nueva caché sólo con la autenticación autorizada, pasar su piloto y renovar la señal técnica si caduca antes de otro ensayo.
2. Repetir carga sostenida y reconexiones, separar saturación de generadores de fallos CDN, comprobar cuotas, contabilizar el saldo de presupuesto y retirar temporales.
3. Probar Windows, web y Android en la ruta protegida, incluyendo bloqueo, cambio de red y recuperación. Las pruebas físicas actuales corresponden a la ruta anterior.
4. Completar recuperación en dispositivos físicos y operación automática ante caída del codificador; instalar medición periódica y comprobar entrega de alertas de reproducción. La recuperación del mismo receptor pasó sólo en el laboratorio aislado. El correo de coste recibido no sustituye estas alertas.
5. La sala elegida es DKTLF3; renovar el permiso si caduca y completar el expediente real `QSESSION_MASS_BROADCAST_READINESS_FILE`. Sólo entonces activar `cdn-only` para esa sala a 10000. Nunca regresar masivamente al SFU ni usar fixtures de ensayo como evidencia real.

Preflight local: `node scripts/check-mass-broadcast.cjs --env-file deploy/broadcast-10000.env.example --readiness-file deploy/broadcast-10000-readiness.example.json`. Debe seguir pendiente mientras falten evidencias. Monitor de lectura: `node scripts/monitor-broadcast.cjs --room DKTLF3`; autoprueba: `--self-test`. Procedimiento: `docs/BROADCAST-OPERATIONS.md`.

Fuentes: [Egress](https://docs.livekit.io/transport/self-hosting/egress/), [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [DS en GoDaddy](https://www.godaddy.com/en-uk/help/add-a-ds-record-23865).
