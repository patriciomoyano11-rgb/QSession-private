# Cotizaciones de eventos y aforo manual

Publicado el 18 de octubre de 2026 como `qsession-20261018-event-capacity-v1`.

En Crear sesión → Plan y acceso aparecen dos entradas: Evento de 10.000 personas y Aforo personalizado. Ambas abren el mismo cotizador, con opción de escribir de 1 a 50.000 personas simultáneas. El valor debe ser un entero: el servidor rechaza valores fuera del rango, sin reducirlos a 5.000 ni redondearlos. El resumen se puede copiar mediante el portapapeles web o el puente nativo de Android.

Hasta 5.000 personas se conservan las reglas comerciales anteriores. Por encima de 5.000, la estimación continúa la pendiente del tramo existente de 1.000 a 5.000, con duración, sesiones y soporte opcional. No se añadió una tarifa comercial fija aprobada para 10.000. La respuesta y el plan informativo incluyen `requiresReview: true`, `priceStatus: estimate`, `deliveryMode: dj-broadcast` y `capacityValidated: false`; el checkout permanece deshabilitado. La API rechaza el pago de estos tokens, aunque el cliente altere precios o funciones. Solo se describe audio y video del DJ a 720p, sin cámaras/micrófonos de oyentes ni funciones interactivas adicionales.

La configuración de una sala permite fijar un aforo manual dentro del plan contratado. Las entradas inválidas o mayores al plan fallan antes de modificar la sala; no se guardan silenciosamente con otra cifra. Se mantiene la opción Estimación frente a Límite máximo. Los planes, créditos y límites de las salas existentes no se ampliaron.

Validación: 39 pruebas de facturación, interfaz, configuración de sala y plataforma pasaron. Se probaron cotizaciones de 10.000 y 12.345, aforos inválidos, firma alterada, pedido bloqueado para estimaciones, respuesta asíncrona desactualizada y modificación/cierre durante el pedido. Revisión visual en escritorio y en un marco móvil de 390 px; no equivale a instalar una nueva APK o un nuevo ejecutable Windows. La publicación actualiza la interfaz web compartida por las aplicaciones.

La publicación se construyó sobre la imagen activa, con siete archivos acotados y sus versiones previas verificadas por hash. La aplicación quedó saludable en modo interactivo. Se comprobó que JNTUBY conservó su plan, aforo, conexión del DJ y los mismos procesos independientes de difusión.

Esta publicación no certifica 10.000 reproducciones ni activa recepción masiva. El control distribuido de admisiones CDN y la prueba de carga siguen pendientes. La prueba de carga autorizada hasta US$5 no llegó a crear servidores temporales cuando se interrumpió la revisión automática.
