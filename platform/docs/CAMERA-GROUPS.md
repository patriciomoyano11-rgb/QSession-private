# Cámaras de Personas: grupos de seis

Publicado en qsession.org: 26 de septiembre de 2026, junto con account-access-v1.

- Cada cliente recibe hasta seis cámaras públicas de otros usuarios. El DJ
  permanece en la señal principal y no ocupa un lugar en el grupo.
- «Ver otro grupo» elige participantes al azar; prioriza personas que aún no se
  han mostrado y evita el grupo anterior cuando hay seis alternativas.
- Las actualizaciones de presencia conservan el grupo; se reemplazan personas
  que salen, ocultan su perfil o apagan su cámara. Con menos de seis cámaras se
  muestran las disponibles. Si ninguna está encendida, se recorren perfiles
  visibles en grupos de seis sin descargar video.
- La selección usa publicaciones anunciadas, no pistas ya descargadas. Sólo se
  solicita una pista de cámara por persona; se excluyen otras sesiones propias,
  perfiles ocultos, pantallas compartidas y publicaciones adicionales.
- Al cambiar de grupo se envían las desuscripciones antes que las suscripciones.
  Al salir de Personas, ocultar la pestaña o recibir el aviso de segundo plano
  de Android se desuscriben las cámaras públicas del grupo.
- Las cámaras públicas de oyentes se publican con un máximo configurado de
  300.000 bits/s y 15 fps, sin simulcast. El DJ y las llamadas privadas mantienen
  sus opciones independientes. El límite de bitrate no incluye tráfico de
  protocolo, retransmisiones ni chat.
- Con HLS activo se conserva el grupo social; sólo las pistas de la señal
  principal dejan de recibirse por WebRTC.

La interfaz web es también la interfaz del WebView Android actual. Las versiones
anteriores deben recargar los recursos para adoptar este comportamiento.

## Validación y alcance

`node --test test/people-cameras.test.js` comprueba rotación, salas pequeñas y de
500 personas, estabilidad, salidas, privacidad, orden de desuscripción,
HLS/WebRTC y parámetros de publicación. La suite general se ejecuta mediante
`npm test`. La vista vacía se comprueba en el navegador local.

Estas pruebas usan publicaciones simuladas: falta medir tráfico con cámaras
reales, reconexiones y dispositivos Android antes de convertir la estimación de
costos en una garantía. El límite pertenece al cliente oficial; no es una cuota
de facturación ni una restricción del servidor frente a clientes modificados.
Las llamadas privadas y el tráfico del DJ se contabilizan por separado.
