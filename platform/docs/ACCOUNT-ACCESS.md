# Corrección de acceso y autocompletado

Publicado en qsession.org el 26 de septiembre de 2026 (account-access-v1).

La autenticación podía completarse correctamente, pero renderAccount llamaba a
renderGlobalPresenceControl y fallaba al mostrar el país compartido por usar
escapeHtml, inexistente en el cliente. Se reutiliza escapeAttribute, que escapa
los caracteres HTML antes de interpolar el nombre del país.

El formulario declara username/current-password para entrar y new-password
para registro. El navegador o gestor del dispositivo administra las contraseñas;
la aplicación sólo guarda el correo si está seleccionada la casilla correspondiente.
El botón Mostrar/Ocultar cambia el tipo de entrada sin modificar su contenido.
Después del acceso el formulario se oculta sin reiniciarlo prematuramente para
permitir que los gestores detecten el envío. Al salir se limpia la contraseña.

Validación: 56 pruebas de plataforma aprobadas; registro, cierre de sesión,
recarga con correo recordado y nuevo inicio de sesión comprobados en navegador
local con una cuenta ficticia. En producción se verificó la restauración del
perfil con la sesión ya existente, sin solicitar ni cambiar la contraseña.

Despliegue: seis archivos públicos, incluyendo los grupos de cámaras previamente
preparados. Se reconstruyó la imagen y se actualizaron archivos del contenedor
en ejecución sin reiniciar servicios. Respaldo remoto previo:
`/opt/qsession/backups/account-access-20260926T195003Z`.

## Ciclo completo de la cuenta (account-lifecycle-v2)

La cuenta incorpora confirmación visual de contraseña al registrarse, controles
para mostrar u ocultar cada contraseña y la opción **Recordarme en este
dispositivo**. Esta opción crea una cookie HttpOnly de 30 días y recuerda sólo
el correo en el almacenamiento local. Si se desmarca, la cookie termina al
cerrar el navegador y el servidor limita la sesión a 12 horas. Q Session nunca
guarda la contraseña en el navegador.

La recuperación usa un código numérico de seis dígitos, válido durante 15
minutos y una sola vez. En el estado de Q Session sólo se guarda un HMAC del
código. Al definir una nueva contraseña se invalidan todas las sesiones
anteriores y se crea una sesión nueva para el dispositivo que completó la
recuperación.

El envío se realiza con Resend usando la API HTTPS. Producción necesita:

```dotenv
QSESSION_RESEND_API_KEY=re_...
QSESSION_RECOVERY_FROM_EMAIL="Q Session <acceso@correo.qsession.org>"
QSESSION_PUBLIC_URL=https://qsession.org
```

El remitente debe pertenecer a un dominio verificado en Resend. Si estas
variables no están configuradas, la API responde claramente que el correo de
recuperación aún no está disponible; nunca afirma que un mensaje fue enviado.
La respuesta de una solicitud válida es deliberadamente igual para correos
registrados y no registrados, evitando revelar qué personas tienen una cuenta.

Desde **Perfil > Tus datos y tu cuenta**, la persona puede descargar en JSON la
información asociada a su cuenta. El archivo excluye hashes, tokens, claves y
secretos. La eliminación exige escribir `ELIMINAR` y volver a confirmar la
contraseña. Se eliminan sesiones, salas, perfiles visibles, archivos, presencia,
playlists y bonos; los comprobantes contables se conservan sin correo y el
historial de mensajes destinado a otras personas queda anonimizado.
