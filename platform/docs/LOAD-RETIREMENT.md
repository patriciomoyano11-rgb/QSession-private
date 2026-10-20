# Retirada independiente de generadores de carga

Actualizado el 19 de octubre de 2026. **Instalado y verificado contra Vultr**:
el timer independiente eliminó los siete generadores en su propio ciclo y el
programa confirmó siete 404. Se verificaron los tres permanentes intactos.
Después se deshabilitó el timer y se retiraron clave y configuración del
codificador; la clave del proveedor fue revocada, la API volvió a deshabilitada
y se restauró la lista de IP previa. El código permanece para futuras tandas;
actualmente no hay servicio de retirada activo ni credencial disponible.

Autorizaciones: `call_905dce8a6a194df1a7f2571513fcaed9` (US$3 adicionales y
servicio temporal), `call_73df9e82d69f4cd4bec451b7c2ca6c72` (activación temporal
de API de My Org). Cómputo nuevo observado: US$1,05, pendiente de factura, sin
Cloudflare/impuestos. No se reutilizó la autorización agotada de US$6.
Evidencia: `release/guarded-retirement-verified-20261020.json`,
`release/guarded-vultr-access-closed-20261020.json` y
`release/broadcast-10000-closeout-20261020.json`.

## Diagnóstico posterior: un generador

El mismo mecanismo retiró también la tanda `qsession-load-20261020-a546fd0a`.
Se verificaron 404, borrado en el journal independiente y tres permanentes
saludables antes de parar el timer y quitar su clave. `maximumInstances=1` está
soportado por las herramientas; la clausura no exige siete objetivos.
La clave del proveedor se revocó y la lista volvió a 217.138.213.4/32, sin la
IP temporal del codificador; API deshabilitada. Coste observado US$0,15 adicional,
US$1,20 de la autorización nueva US$3, sujeto a factura. La autorización de dos
repeticiones se completó; una pasó y otra falló. Cero máquinas reutilizables.

Evidencias: `release/diagnostic-retirement-verified-20261020.json`,
`release/diagnostic-vultr-access-closed-20261020.json` y
`release/hls-diagnostic-closeout-20261020.json`. No reiniciar el timer sin preparar
una nueva tanda autorizada y una credencial temporal nueva.

## Funcionamiento y límites

`platform/scripts/retire-load-generators.py` consulta exclusivamente la API de
instancias. Por defecto sólo previsualiza. `--apply` elimina al vencer el plazo
y comprueba que cada instancia responde 404. Si Vultr falla, el siguiente ciclo
reintenta. Un borrado solicitado no se registra como confirmado hasta comprobar
la ausencia. No apaga máquinas como sustituto de eliminarlas.

El servicio y timer adjuntos en `platform/deploy/` deben ejecutarse en un
servidor permanente, independientemente del chat, SSH y proceso de carga. El timer
se activa cada minuto, al arrancar y tras recuperar una ejecución perdida.
Un error en un generador no impide intentar la retirada de los demás.

Selecciona exclusivamente una etiqueta aleatoria por tanda, nombre exacto de
tanda más `-chi1`…`-chi8`, plan `vhp-8c-16gb-amd`, región `ord` y fecha de
creación dentro de una ventana máxima de 45 minutos. Excluye expresamente las
tres IP permanentes. Vuelve a verificar el objeto por UUID antes de borrarlo.
No sigue redirecciones ni enlaces URL del proveedor. Credenciales y cuerpo de
errores no se imprimen. Un objetivo con atributos distintos queda sin borrar
y produce un error que exige intervención.

Esto reduce el riesgo de abandono del chat; **no garantiza un tope de factura**
ante caída del host de control, indisponibilidad de Vultr, revocación de permisos,
etiquetado erróneo, restricciones de API o problemas de red. El servicio debe
seguir activo después del plazo hasta confirmar la ausencia de toda la tanda.

## Instalación para una futura tanda, antes de contratar generadores

1. Autorizar acceso API temporal con permisos para listar, consultar y eliminar
   instancias desde exclusivamente `45.77.192.82/32`. Revisar los permisos reales
   ofrecidos por Vultr: los filtros del programa no equivalen a un permiso del
   proveedor limitado a siete UUID. No ampliar una clave existente sin revisión.
2. Guardar la clave únicamente en `/etc/qsession-load-guard/vultr.key`, propiedad
   root y modo 0600, directorio root 0700. Nunca pasarla por argumentos o informes.
3. Instalar el script en `/opt/qsession-load-guard/retire-load-generators.py` y
   ambos archivos de unidad en `/etc/systemd/system/`, propiedad root.
4. Preparar `scope.json` root 0600 con el esquema siguiente y una autorización
   **nueva, efectivamente concedida**. Usar tiempos reales justo antes de crear
   máquinas; no reutilizar los ejemplos. Generar tag con `secrets.token_hex(16)`.
5. Verificar las unidades con `systemd-analyze verify`, recargar systemd, activar
   el timer y ejecutar `--preflight`. Confirmar API accesible, timer activo y
   habilitado. Probar el ciclo del servicio sin objetivos y verificar su journal.
   No crear servidores si esta comprobación falla.
6. Crear como máximo siete máquinas con el tag y nombres exactos del scope,
   sin backups, discos externos ni otros extras. Registrar sus UUID, fechas,
   precios de checkout y direcciones. La detección por tag evita depender de
   guardar los UUID en el chat tras cada creación. Confirmar que el proveedor
   ha guardado el tag en cada respuesta de creación.
7. Guardar en inventario `retirementScopeFingerprint` calculado con SHA-256 de
   `json.dumps(scope, sort_keys=True).encode('utf8')` y `newBudget` aprobado.
   La carga exige una comprobación API/SSH nueva (máximo 30 segundos), todos los
   UUID protegidos y por lo menos 15 minutos antes de la retirada.
8. Al terminar, adelantar manualmente la retirada de los UUID aprobados y
   verificar ausencias. Conservar el timer como respaldo hasta verificar cero.
   Entonces deshabilitarlo y retirar/revocar la credencial temporal; guardar
   evidencia sin secretos. Si la API falla, retirar por consola y verificar.

Esquema, **ilustrativo y rechazado sin autorización válida**:

```json
{
  "schemaVersion": 1,
  "runId": "qsession-load-20261020-012345ab",
  "tag": "qs-retire-0123456789abcdef0123456789abcdef",
  "plan": "vhp-8c-16gb-amd",
  "region": "ord",
  "notBefore": "2026-10-20T12:00:00Z",
  "retireAt": "2026-10-20T12:45:00Z",
  "maximumInstances": 7,
  "budgetAuthorizationReference": "PENDING"
}
```

`newBudget` en el inventario: `status: approved`,
`authorizationReference: <respuesta real de autorización nueva>`,
`additionalComputeLimitUsd: 3`. Los informes anteriores no cambian ni se
consideran reembolsados. El control rechaza las dos autorizaciones agotadas.

## Presupuesto de la tanda autorizada y finalizada

Consulta pública de `/v2/plans?per_page=500`, 19 de octubre:
`vhp-8c-16gb-amd`, 8 vCPU/16 GB, almacenamiento local, Chicago disponible,
US$0,132/h por máquina. Siete cuestan US$0,924/h a tarifa publicada.
Reserva prudente: US$0,15 por máquina/h × 7 × 2 horas = US$2,10.
Se autorizaron **US$3 adicionales de cómputo**, sin servidores permanentes
nuevos, y se observaron US$1,05 en la tanda finalizada. Retirada inicialmente
programada a los 45 minutos desde el inicio del scope; al terminar las cargas
se adelantó y el timer la ejecutó a las 00:53 UTC del 20 (19:53 de Colombia,
19 de octubre), antes de la primera hora desde la creación de las máquinas.
Confirmar de nuevo el precio y la disponibilidad en checkout.

No incluye impuestos ni Workers/R2/Durable Objects, que conservan facturación
por uso ya aprobada. No es el precio de un evento real de 10.000 espectadores.
Si no hay margen temporal o falla la prueba, retirar y registrar el resultado;
no extender el plazo ni contratar otra tanda automáticamente.

## Comprobación

`python -m unittest discover -s platform/test -p test_load_retirement.py -v`

Pruebas con proveedor simulado: no es una eliminación real en Vultr.
La carga completa y recuperación/dispositivos siguen pendientes.

Referencias oficiales:
- https://docs.vultr.com/support/platform/billing/are-stopped-instances-still-billed-on-vultr
- https://docs.vultr.com/support/platform/users/how-can-i-manage-api-access-for-users
- https://github.com/vultr/vultr-csharp (API y paginación)
- https://api.vultr.com/v2/plans?per_page=500

## Diagnóstico de descarga preparado el 19 de octubre de 2026 (Colombia)

La publicación de diagnósticos y su piloto de un cliente ya terminaron; su
autorización de Wrangler está cerrada. La repetición de siete generadores
también terminó y todos fueron retirados. No reutilizar esos permisos ni sus
reservas como un presupuesto nuevo.

`release/media-diagnostic-proposal-20261020.json` propuso un único generador y
dos ejecuciones como máximo: 1.000 clientes durante 60 segundos completos y,
sólo si pasa con limpieza completa, 1.500 durante otros 60 segundos. Un fallo
detiene el diagnóstico. No autoriza repetir 10.000 ni certifica esa capacidad.
El control registra cada ejecución antes de generar tráfico y exige evidencia
de la misma tanda para permitir la segunda.

La reserva autorizada fue US$0,30 de cómputo (dos horas a un máximo de
US$0,15/h); la consulta pública conservada informa US$0,132/h. La autorización
`call_608884c01a19419ca569a6f699db999a` cubrió el presupuesto y el acceso
temporal a la API de My Org, restringido al codificador, con retirada del
servidor independiente del chat a los 45 minutos, revocación de clave,
restauración de la IP anterior y API deshabilitada al terminar.

El límite anterior US$3,60 conserva US$1,20 observados y US$2,40 de reservas
sin factura verificada. Sumando la propuesta, la exposición reservada sería
US$3,90; no es un importe observado ni la factura final. Se conservan también
los registros de costes anteriores y sus excesos. Impuestos y uso de
Workers/R2/Durable Objects siguen aparte. Si PRB10A caduca, no renovarla
implícitamente con esta preparación.

La tanda terminó: 1.000 pasó y 1.500 falló el criterio de continuidad. El
temporizador eliminó el único generador; se verificaron tres permanentes
saludables, se retiraron la clave y el scope remotos, se revocó la clave del
proveedor, se restauró la lista anterior y se deshabilitó la API. Evidencias:
`release/media-diagnostic-closeout-20261020.json` y
`release/media-diagnostic-retirement-verified-20261020.json`. No reutilizar su IP
ni su clave. El cargo final todavía no está verificado.

La repetición de 10.000 solicitada por el usuario requiere otro scope:
`prepare-retirement-scope.py --approved-full-media-proposal <aprobación nueva>
--inventory <inventario nuevo>`. Está limitada a siete máquinas y una sola
ejecución de 620 s con reconexiones al segundo 240, con reserva independiente
de US$2,10 y retirada al terminar o a los 45 minutos. Las reservas anteriores
permanecen registradas; no se convierten en cargos observados ni en saldo nuevo.
La exposición reservada de esta etapa pasaría de US$3,90 a US$6,00; no es una
factura final. No renovar PRB10A ni reiniciar la API sin la aprobación nueva
prevista en esa propuesta.
## Restricción posterior al cierre del 20 de octubre

Las tandas previas están cerradas. No reutilizar sus autorizaciones, inventarios
ni reservas. Antes de preparar una nueva credencial, contratar o generar tráfico,
`hls_candidate_readiness.py` debe confirmar la misma fuente de Worker en las
pruebas locales, publicación y piloto protegido. Mientras falte publicación o
piloto, el bloqueo es el comportamiento esperado.

El próximo alcance debe tener una referencia nueva, presupuesto explícito y
huella de la fuente verificada. El plan nuevo de ocho procesos exige CPU,
afinidad y cuotas verificadas antes de abrir concesiones en cada generador.
Los informes de progreso cuentan la partición real; no equivalen al informe
final de continuidad. Permanecen la retirada independiente a los 45 minutos,
la prohibición de repetir una creación de resultado desconocido y el cierre
de clave, API y lista de IP al finalizar.
