# Operación de derechos de contenido

## Alcance de lanzamiento

- El anfitrión elige entre sala pública o privada por enlace, código o QR.
- Una sala pública sólo debe utilizar el catálogo original revisado por Qsession o contenido propio o debidamente autorizado.
- El anfitrión debe aceptar la declaración vigente de titularidad o autorización.
- La privacidad limita el descubrimiento; no sustituye licencias que puedan ser necesarias.
- Las grabaciones y nuevas incorporaciones al catálogo requieren revisión antes de publicarse.

## Flujo de reporte

1. El titular presenta el formulario público en `/reportar-contenido.html`.
2. QSession registra la obra identificada, localización, contacto, declaraciones y firma.
3. Un administrador revisa el caso en `/admin` y puede marcarlo en revisión, desestimarlo o confirmarlo.
4. Una confirmación archiva la sala, detiene su salida de borde y crea una sanción activa.
5. El anfitrión puede apelar con la cuenta que creó la sala y aportar su fundamento o licencia.
6. Una restitución revierte la sanción; si quedan menos de tres sanciones activas, la cuenta puede reactivarse.

## Reincidencia

Tres sanciones activas por propiedad intelectual suspenden la cuenta, invalidan
sus sesiones y archivan sus salas. Las sanciones desestimadas o restituidas no
cuentan. Incidentes graves, fraude, peligro u órdenes válidas pueden justificar
una actuación inmediata independiente de ese umbral.

## Evidencia conservada

- Cuenta y perfil que crearon la sala.
- Fuente declarada, activo grabado o imagen y fecha.
- Versión y momento de aceptación de la declaración de derechos.
- Reporte, historial de decisiones, apelaciones y medidas aplicadas.

Los reportes de derechos no se eliminan al borrar una sala. La exportación del
anfitrión oculta el correo del reclamante; el detalle completo sólo está
disponible para administración autorizada.

## Operación de salas públicas

`QSESSION_PUBLIC_ROOMS_ENABLED=true` habilita la creación y el directorio. Una
sala sólo aparece públicamente cuando está activa y cuenta con señal y personas
conectadas. Conserve documentada la procedencia del catálogo, la moderación, la
privacidad, los términos locales y el canal de contacto para reportes. Use
`QSESSION_PUBLIC_ROOMS_ENABLED=false` como interruptor operativo si fuera
necesario suspender temporalmente nuevas salas públicas.
