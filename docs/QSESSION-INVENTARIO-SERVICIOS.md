# Inventario de servicios de Q Session

Actualizado: 25 de septiembre de 2026.

Este documento no contiene contraseñas, tokens, claves privadas ni datos de
tarjetas. Indica el método de acceso y la ubicación segura de los archivos que
ya existen en este equipo.

## Servicios externos verificados

| Servicio | Estado | Enlace | Costo o suscripción | Acceso seguro |
| --- | --- | --- | --- | --- |
| Vultr Cloud Compute | Activo. `qsession.org` opera en el servidor independiente `qsession-prod-1`; Qsound permanece separado. | https://console.vultr.com/ | Importe exacto pendiente de consultar en la cuenta; no se debe estimar como si fuera una factura. | La cuenta del panel no está guardada en el repositorio. La publicación usa la clave SSH local `qsession_deploy_ed25519`; la clave privada no se copia ni se publica. |
| GoDaddy Domains | Activo como registrador y DNS de `qsession.org` y `qsound.org`. | https://dcc.godaddy.com/control/portfolio | Renovación anual; el importe real sólo puede confirmarse en las facturas de GoDaddy. `qsession.org` vence el 7-sep-2027 y `qsound.org` el 31-ago-2028 según RDAP. | No se encontraron credenciales de GoDaddy en el proyecto. Acceso desde la cuenta del titular. |
| Cloudflare R2 + Workers | Activo. Buckets privados `qsession-live` y `qsession-live-preview`, eliminación automática de `live/` después de 1 día y Worker público `qsession-live`. Q Session entrega HLS desde R2 mediante el Worker. | https://dash.cloudflare.com/ | Suscripción base de R2: US$0; incluye la franquicia mostrada por Cloudflare al activarlo y luego cobra por almacenamiento y operaciones según consumo. Workers aplica el plan y límites vigentes de la cuenta. | Acceso mediante Google. La credencial S3 de producción está limitada al bucket `qsession-live` y a la IP del servidor Q Session. Sus valores sólo están en los entornos privados local y del servidor. |

## Componentes activos sin suscripción independiente

| Componente | Estado | Costo adicional | Credenciales/configuración |
| --- | --- | ---: | --- |
| LiveKit Server | Activo y configurado en `wss://media.qsession.org`. Es autoservido, no LiveKit Cloud. | US$0 aparte del VPS | `platform/deploy/qsession.env`; contiene `LIVEKIT_API_KEY` y `LIVEKIT_API_SECRET`. No copiar sus valores. |
| PostgreSQL | Activo para el chat de Q Session. | Incluido en el VPS | Contraseña y cadena de conexión en el entorno privado del servidor. |
| Redis | Activo para presencia y distribución en tiempo real. | Incluido en el VPS | Sólo interno en el servidor; no debe exponerse públicamente. |
| Caddy y certificados TLS | Activo como proxy HTTPS y certificados automáticos. | US$0 | Configuración privada en el servidor; no requiere clave comercial. |
| Docker / Docker Compose | Activo para ejecutar la pila. | US$0 | Sin cuenta comercial para esta instalación. |
| Distribución HLS por R2 | Activa. `/api/status` informa `provider: cloudflare-r2-hls`, `deliveryMode: object-storage` y `configured: true`. Segmentos de 6 s, latencia aproximada de 18 s y 0,7776 GB por espectador/hora con el perfil actual. | Consumo de R2 y Workers | Configuración privada en `platform/deploy/qsession.env`; no copiar las claves. |

## Preparado, pero no contratado o no activado

| Servicio | Estado comprobado | Costo actual | Claves |
| --- | --- | ---: | --- |
| Cloudflare Stream | Pendiente. `/api/status` informa `directVideoUploads.configured: false`. | US$0 actualmente | No configuradas. |
| Wompi | La estructura de pagos está programada, pero `/api/status` informa `wompiCheckout: false`. | US$0 mientras no haya comercio activo ni transacciones | No hay llaves Wompi en `platform/deploy/qsession.env`. |
| Proveedores de música | Sólo existe un estudio de alternativas; no hay proveedor contratado en el producto. | US$0 actualmente | Ninguna. |

## Accesos propios de Q Session

- Administración web: https://qsession.org/admin
- Credencial administrativa local:
  `C:\Users\maria\OneDrive\Documents\ChatGPT\Q Sound\private\admin\QSession-admin-credentials.txt`
- Código de recuperación administrativo:
  `C:\Users\maria\OneDrive\Documents\ChatGPT\Q Sound\private\admin\QSESSION-ADMIN-RECOVERY-CODE.txt`
- Entorno privado de despliegue:
  `C:\Users\maria\OneDrive\Documents\ChatGPT\Q Sound\QSession\platform\deploy\qsession.env`
- Firma de Android:
  `C:\Users\maria\OneDrive\Documents\ChatGPT\Q Sound\QSession\private\android-signing\qsession-release.jks`
- Clave de recuperación de firma Android: guardada en la misma carpeta privada;
  no debe enviarse por mensajería ni incorporarse a la aplicación.

## Pendientes para cerrar el inventario económico

1. Recuperar el acceso correcto a Vultr y registrar el plan, importe mensual,
   fecha de corte, saldo y método de pago.
2. Consultar en GoDaddy el precio real de renovación de los dos dominios y si
   la renovación automática está habilitada.
3. Definir alertas de facturación para R2 y Workers y revisar el consumo durante las primeras pruebas reales.
4. Activar Wompi primero en Sandbox; no copiar llaves por chat ni guardarlas en
   el repositorio.
5. Añadir facturas de cualquier servicio no visible desde el proyecto, como
   OneDrive, OpenAI/Codex o tiendas de aplicaciones, si se desean incluir como
   gastos generales del negocio.
