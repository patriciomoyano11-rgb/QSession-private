# Borde audiovisual de Q Session

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


Configuración preparada para distribuir una sola señal HLS del DJ desde
Cloudflare R2.

El candidato adicional `43193e67` corrige la coalescencia de admisión,
rechaza sin I/O los mapas pendientes llenos y comparte un backoff breve de 503.
Conserva plazos, TTL y límite RAM de 4.096. Pasaron 75 pruebas dirigidas y workerd
local (128 cuerpos con una admisión compartida, 192 recuperaciones de caché y 96
de compatibilidad). Los diagnósticos del cliente también se ampliaron con una
prueba dirigida. Se publicó únicamente en PRB10A como
`2cc2e45e-aeaf-4e08-9cd5-6ff813e1713b`, pasó un piloto protegido de un cliente y
Wrangler quedó revocado. Se conservan los siete enlaces y namespace. Vultr siguió
cerrado y no se ejecutó otra carga masiva. **No está validado a 10.000**.
Véanse `release/admission-coalescing-report-20261020.json` y
`release/admission-coalescing-closeout-20261020.json`.

La reparación local `9017a99a` desacopla la entrega de la retención de Cache API:
verifica el cuerpo completo una sola vez y comparte un Blob con respuestas
independientes. Limita el conjunto de cuerpos a 32 MiB, 64 entradas y 256 lectores;
las reservas de construcción y los cuerpos retirados pero aún usados siguen
contabilizados. La caché externa es opcional y tiene dos escrituras concurrentes.
La admisión sigue siendo obligatoria antes de acceder a cualquier cuerpo.
Pasaron 85 pruebas dirigidas, siete del cliente y workerd local con 128 cuerpos
normales, 192 recuperados ante fallos de caché y 96 de compatibilidad. Los límites
locales no equivalen a rendimiento global. Este candidato fue publicado solo en
PRB10A como `ec60955e-20f8-4c4f-9be6-502bd764c934`; pasó el piloto protegido y
Wrangler quedó revocado. La nueva prueba sostenida terminó fallida: 43.493
HTTP 503, 8.492 segmentos incompletos y cuatro procesos de laboratorio detenidos
tempranamente. No hubo tramo común completo para 10.000. Los siete temporales
se eliminaron, los accesos se cerraron y producción conservó su imagen y trabajos.
**10.000 continúa sin validarse**; véase
`release/edge-r2-recovery-sustained-closeout-20261020.json`.

La carga del 20 de octubre sobre la versión `e2aaf9e0` falló durante la rampa:
10.021 HTTP 503 de segmentos, pico alineado de 7.676 clientes y cero segundos
comunes a 10.000. Los 56 procesos terminaron en 26–28 s; no se ejercieron
hold ni reconexiones. Los siete generadores quedaron eliminados y el acceso
temporal cerrado. Véanse `release/edge-r2-sustained-closeout-20261020.json` y
`platform/docs/BROADCAST-10000.md`. El piloto de un cliente descrito abajo es evidencia
anterior y no convierte esta versión en capacidad validada para 10.000.

## Canario del 20 de octubre: lectura R2 y caché por borde

Publicado como versión `e2aaf9e0-bda0-4dc8-b741-20740bf9aa63` y comprobado
con un cliente protegido; expediente `release/edge-r2-pilot-20261020.json`.
El aforo de 10.000 continúa sin certificarse. La variable
`QSESSION_R2_EDGE_CACHE_ROOM=PRB10A` habilita únicamente la sala técnica y
exige que `QSESSION_ADMISSION_ROOM` siga siendo `PRB10A`. Se comprueba admisión
antes de acceder a caché. Tanto índices como segmentos evitan el actor privado;
sus enlaces, namespace y clase se conservan para reversión. Eliminar esta
variable devuelve la sala a la ruta compartida anterior.

Los llenados concurrentes comparten una operación por objeto. Cada isolate
admite 4 lecturas de R2 activas y 16 en cola; la lectura mantiene su plaza hasta
terminar o cancelar realmente su cuerpo. Hay como máximo 64 operaciones,
128 esperas por clave y 256 esperas totales, con plazo de 4 segundos y espera
de un segundo después de fallos. Un upstream que ignora cancelación no libera
capacidad ficticia. Estos límites no son límites globales de la red.

Solo se almacenan respuestas canónicas completas: segmentos de hasta 8 MiB e
índices de hasta 64 KiB. La personalización del índice ocurre después de la
autorización. Las faltas 404 no se guardan negativamente. Una escritura
rechazada/no retenida, un cuerpo incompleto o un tiempo agotado da 503 y no
dispara una segunda lectura por oyente. La ruta anterior también deja de
consultar al mismo actor después de un llenado fallido, para evitar amplificar
su sobrecarga. Esto reduce disponibilidad durante una avería deliberadamente;
no debe presentarse como una garantía de entrega.

Verificación reproducible sin credenciales remotas:

```powershell
python platform/scripts/test-edge-cache-context-local.py --delivery r2-edge --scenario normal --concurrency 16 --requests 96 --output release/edge-r2-workerd-normal-20261020.json
python platform/scripts/test-edge-cache-context-local.py --delivery r2-edge --scenario faults --concurrency 16 --requests 96 --output release/edge-r2-workerd-faults-20261020.json
python platform/scripts/hls_candidate_readiness.py
```

El último comando comprueba que se publicó la misma fuente y se verificó un
cliente protegido con limpieza y revocación de sesión. Ahora pasa; sigue siendo
necesaria una autorización nueva de presupuesto/acceso para contratar otra tanda.
La prueba local no mide R2 real, caché entre centros de datos, ancho de banda,
decodificación audiovisual ni capacidad para 10.000.

## Recursos

- Bucket de producción: `qsession-live`
- Bucket de vista previa: `qsession-live-preview`
- Worker: `qsession-live`
- Binding del Worker: `QSESSION_LIVE`
- Prefijo efímero: `live/`
- Conservación máxima: 24 horas

## Activación

1. Confirmar en Cloudflare que R2 figura como suscripción activa.
2. Crear los dos buckets con almacenamiento Standard.
3. En ambos buckets, crear una regla de ciclo de vida que elimine los objetos del
   prefijo `live/` después de un día.
4. Desde esta carpeta, autenticar Wrangler y ejecutar `npx wrangler deploy`.
5. Conservar la dirección `workers.dev` publicada y usarla temporalmente como
   `QSESSION_BROADCAST_STORAGE_PLAYBACK_BASE_URL` y
   `QSESSION_EDGE_PLAYBACK_BASE_URL`.
6. Crear una credencial S3 restringida exclusivamente a `qsession-live`; esta
   acción requiere confirmación expresa y la clave sólo debe copiarse al archivo
   privado del servidor.
7. Completar endpoint, access key y secret key en
   `/opt/qsession/deploy/qsession.env`, volver a desplegar y comprobar que
   `/api/status` muestre `deliveryMode: object-storage`.

No publiques `r2.dev`, no guardes una credencial en Git y no concedas acceso a
todos los buckets de la cuenta.

## Caché privada de fragmentos

El 19 de octubre se publicó `QSessionSegmentCache` con binding
`QSESSION_SEGMENT_CACHE` en el mismo Worker. La variable
`QSESSION_SHARED_CACHE_ROOM=PRB10A` limita su uso a la sala técnica, cuya
admisión se comprueba antes de consultar el namespace. No se pasan tokens,
cookies ni direcciones de clientes al objeto privado. Se conservan bytes
canónicos y se personaliza el manifiesto después de autorizar al oyente.

Cada isolate limita la caché a 24 MiB y cuatro lecturas simultáneas de R2;
cada objeto admite hasta 8 MiB, los manifiestos caducan en 750 ms y los
segmentos en 60 s. Las respuestas grandes se transmiten en fragmentos de
8 KiB con contrapresión. Hay 64 particiones por prefijo, sin escritura de
medios en SQLite, alarmas ni temporizadores persistentes. El consumo de
Durable Objects es por uso dentro de Workers Paid; no implica otro servidor.

El piloto protegido pasó, incluida lectura parcial nativa y rechazo de
admisiones ausentes. La carga de 10.000 sobre este namespace permanece sin
validar. No habilitarlo para una sala comercial ni ampliar aforo a partir de
pruebas locales o del piloto de un solo cliente. Expediente:
`release/broadcast-10000-closeout-20261019.json`.
