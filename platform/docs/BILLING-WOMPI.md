# Cobros y bonos de Q Session

## Estado seguro inicial

La aplicación incluye catálogo, órdenes, webhooks, libro contable de bonos,
reservas, consumo y controles administrativos. Los cobros permanecen apagados
hasta completar las pruebas de Wompi Sandbox:

```env
QSESSION_BILLING_ENFORCED=false
QSESSION_WOMPI_PUBLIC_KEY=pub_test_...
QSESSION_WOMPI_INTEGRITY_SECRET=test_integrity_...
QSESSION_WOMPI_EVENTS_SECRET=test_events_...
```

Las llaves se copian directamente en `/opt/qsession/deploy/qsession.env` con
permisos restringidos. No deben enviarse por chat, guardarse en Git, ni
incorporarse a las aplicaciones Android o Windows.

## Configuración en Wompi

1. Activar el comercio y la cuenta Bancolombia de desembolso.
2. Copiar las llaves Sandbox en el servidor.
3. Configurar como URL de eventos Sandbox:
   `https://qsession.org/api/webhooks/wompi`.
4. Ejecutar una compra de prueba y comprobar en `/admin` que la orden quede
   aprobada y que el bono aparezca disponible.
5. Repetir la prueba de webhook para confirmar que no duplica el bono.
6. Sustituir las llaves por las de producción y configurar por separado la URL
   de eventos de producción.
7. Hacer una compra real de importe controlado y conciliarla con Wompi.
8. Sólo entonces activar `QSESSION_BILLING_ENFORCED=true`.

## Reglas del bono

- Crear la configuración de una sala reserva una unidad.
- Solicitar la credencial de transmisión del DJ consume la reserva.
- Eliminar o cerrar una sala que nunca transmitió libera la unidad.
- Un webhook repetido no entrega un segundo bono.
- Precio, capacidad y duración quedan congelados dentro de la orden; editar el
  catálogo nunca altera compras ya realizadas.
- Los ajustes manuales exigen cuenta, plan, cantidad, motivo y administrador.

## Catálogo inicial

Los siguientes son precios de lanzamiento editables desde `/admin`. Conviene
revisarlos después de medir tres eventos reales de cada tamaño:

| Plan | Precio COP | Capacidad | Duración | Usos |
| --- | ---: | ---: | ---: | ---: |
| Sala Esencial 25 | $12.000 | 25 | 120 min | 1 |
| Evento 100 | $27.000 | 100 | 180 min | 1 |
| Evento 250 | $53.400 | 250 | 240 min | 1 |
| Evento 500 | $159.000 | 500 | 240 min | 1 |
| Instructor 50 | $69.000 | 50 | 90 min | 4 |
| Instructor Pro 100 | $169.000 | 100 | 120 min | 8 |
| Comercio 250 | $449.000 | 250 | 240 min | 10 |
| Gran evento 1.000 | $289.000 | 1.000 | 360 min | 1 |
| Mensual Esencial 25 | $39.000/mes | 25 | 120 min | 4 al mes |
| Mensual Comunidad 100 | $89.000/mes | 100 | 180 min | 4 al mes |
| Mensual Pro 250 | $169.000/mes | 250 | 240 min | 4 al mes |

### Qué incluye realmente cada plan estándar

Todos los planes anteriores habilitan la señal principal con **audio y video del
anfitrión**, el chat de la sala, cámaras de participantes y el envío de videos de
participantes. La compra define el máximo técnico disponible; al diseñar la sala,
el organizador puede dejar apagadas las cámaras, el chat u otras funciones que no
necesite. Por eso la pantalla de creación distingue entre lo incluido en el plan
y lo que queda activado para esa experiencia concreta.

La pantalla presenta un solo plan a la vez dentro de menús desplegables. Cada
opción muestra precio, capacidad, duración y un detalle plegable con video,
audio, chat, cámaras, envíos y número de sesiones.

El catálogo presenta primero los planes individuales y, por separado, la
mensualidad accesible. Los paquetes de profesores y comercios siguen siendo
compras únicas con varios bonos.

La capacidad comprada se valida al crear la sala y antes de entregar acceso a
nuevos oyentes. La duración comienza cuando el anfitrión solicita por primera
vez la credencial de transmisión. Los tokens multimedia no pueden superar el
tiempo restante del plan.

## Salas personalizadas

El configurador calcula en el servidor una cotización según capacidad, duración,
cantidad de salas, cámaras y micrófonos de participantes, videos, grabación,
idiomas, IA, visuales VJ y acompañamiento. El navegador recibe un token firmado
válido durante 30 minutos; el checkout toma el precio de ese token y nunca de un
campo editable del cliente. Al aprobarse el pago se entrega un bono con los
límites exactos de la cotización y la orden aparece en los reportes de
administración.

## Suscripciones

`Mensual Esencial 25` entrega cuatro bonos válidos durante 35 días por un pago
de $39.000 COP. En la primera etapa su renovación es manual y sin permanencia:
no se realiza un débito automático. Antes de ofrecer renovación automática se
deben conectar fuentes de pago tokenizadas, consentimiento explícito,
calendario de cobro, reintentos y cancelación.

## Conciliación

Wompi deposita el dinero en la cuenta asociada al comercio. Q Session no maneja
ni almacena credenciales bancarias. El panel administrativo registra ventas,
estados de orden, transacciones, bonos disponibles, reservas y consumos; el
dashboard de Wompi sigue siendo la fuente para conciliar desembolsos y tarifas.
