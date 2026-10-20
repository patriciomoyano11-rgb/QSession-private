# Codificador dedicado de QSession

Host: `45.77.192.82`, Miami, 4 vCPU / 8 GB. Egress v1.14.1 conectado a LiveKit y Redis por túnel SSH. No expone Redis ni puertos de salud públicamente.

Composición: `/opt/qsession-encoder/compose.yml`. Configuración privada: `/opt/qsession-encoder/private/egress.yaml`, UID 1001 y modo 0400. Servicio de túnel: `qsession-egress-tunnel`, habilitado al arranque y con reconexión automática. Usuario remoto: `qsession-egress`, sin shell, reenvío local únicamente a `127.0.0.1:6379`, desde `45.77.192.82`; sin reenvío remoto, agente, X11 ni TTY.

Firewall: entrada solo SSH; HTTPS IPv6 saliente rechazado para conservar el filtro IPv4 aprobado de R2. Token R2 limitado a lectura/escritura de objetos de `qsession-live`, con las IP antigua y nueva autorizadas. Workers Paid activo. Base adicional conjunta: US$53/mes, consumo e impuestos aparte.

Comprobar en el host dedicado:

```sh
systemctl is-active qsession-egress-tunnel
curl --head --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:8081/
cd /opt/qsession-encoder
docker compose ps
```

No imprimir, registrar ni copiar el cuerpo de `8081`: durante un trabajo puede incluir configuración privada y credenciales de almacenamiento. La comprobación anterior pide solamente `HEAD`, descarta encabezados y muestra el código HTTP. El puerto debe seguir limitado a loopback.

`connect-encoder-peer.py` se ejecuta solo en producción y entrega configuración directamente al receptor SSH restringido del nuevo host; no imprime ni guarda secretos localmente. `restrict-encoder-tunnel.py` configura la cuenta dedicada y valida sshd antes de recargarlo. Los scripts contienen claves públicas de estos hosts y no son una receta genérica para otros servidores.

El Egress antiguo está detenido, con `restart=no`, bajo el perfil manual `legacy-encoder`. No arrancarlo junto al nuevo indiscriminadamente: competirían por trabajos. Volver al host antiguo exige revisar recursos y probarlo, porque dispone de 2 CPU compartidas. Sus credenciales se corrigieron y siguen en su configuración privada.

Existen respaldos anteriores en `/opt/qsession/releases/qsession-20261018-egress-segments-v1/compose.release.before.yml` y `/opt/qsession/releases/qsession-20261018-cdn-preparation-v1/compose.release.before.yml`. No prueban compatibilidad con el aforo firmado actual. La imagen publicada de app es `qsession-app:qsession-20261018-cdn-admissions-v1`; JNTUBY permanece en `interactive`, con permiso de 10.000 preparado y todavía no efectivo. Una reversión durante un evento debe conservar cliente HLS, tokens y aforo compatibles; no devolver masivamente la audiencia al SFU.

La infraestructura y reproducción sintética están comprobadas; no se certificó audiencia de 10000. Consultar `docs/BROADCAST-10000.md` para activación, pruebas reales y límites.

Monitor de lectura, todavía sin instalación remota: `scripts/monitor-broadcast.cjs`. El procedimiento de aviso local, ensayo aislado de recuperación y reversión está en `docs/BROADCAST-OPERATIONS.md`. Reinicio automático de un proceso o del túnel no equivale a failover automático de una transmisión.
