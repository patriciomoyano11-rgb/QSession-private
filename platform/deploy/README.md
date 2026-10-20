# Despliegue independiente de Q Session

Esta carpeta contiene la pila completa de Q Session: aplicación, datos, Redis,
LiveKit, TURN y proxy TLS. No lee configuraciones, secretos, binarios ni volúmenes
de ningún otro producto.

Debe instalarse en un servidor o dirección IP propios, porque Caddy, LiveKit y
TURN utilizan los puertos públicos 443/TCP, 3478/UDP y 50000-60000/UDP.

1. Apunta `qsession.org`, `www.qsession.org`, `media.qsession.org` y
   `turn.qsession.org` al servidor nuevo.
2. En un VPS nuevo con Ubuntu 24.04, ejecuta `bash prepare-vps.sh` como root.
3. Ejecuta `node render-config.js --domain qsession.org` una sola vez.
4. Completa en `qsession.env` el usuario y el hash de contraseña administrativos.
5. Copia o migra únicamente el volumen `qsession-data` del servicio anterior.
6. Ejecuta `bash deploy.sh check` y después `bash deploy.sh deploy`.
7. Verifica web, Android y Windows antes de retirar la ruta anterior.

Los archivos `qsession.env`, `livekit.yaml` y `caddy.yaml` contienen información
privada o específica del servidor y están excluidos de Git.
