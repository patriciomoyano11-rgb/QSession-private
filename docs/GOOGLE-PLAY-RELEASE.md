# Publicación de Q Session en Google Play

Estado técnico verificado el 28 de septiembre de 2026.

## Candidato actual

- Aplicación: `org.qsession.app`
- Versión: `0.1.38`
- Código: `38`
- Android objetivo: API 36
- Paquete: `releases/QSession-Android-0.1.38-play.aab`
- SHA-256: `B112B59C844A5AC4A1628F1CD4F91C5C724CF581F846E58558360D7FD206519B`
- Firma de carga: válida; el certificado vence el 26 de enero de 2054.
- Resultado automatizado: 62/62 pruebas de plataforma y 71/71 pruebas Android.

Esta compilación incorpora Firebase Cloud Messaging, canales nativos separados para mensajes privados y llamadas entrantes, permiso de notificaciones en Android 13+ y apertura directa de la conversación al tocar el aviso. La app y el registro seguro de dispositivos ya están preparados; falta instalar en el servidor la cuenta de servicio privada de Firebase para habilitar la entrega con la aplicación totalmente cerrada.

Esta primera candidata es **de consumo** en Android: reconoce los bonos asociados a la cuenta, pero no abre Wompi ni dirige al usuario a un pago externo. Las compras dentro de la app se habilitarán sólo después de integrar Google Play Billing.

## URLs para Play Console

- Política de privacidad: `https://qsession.org/privacidad.html`
- Eliminación externa de cuenta: `https://qsession.org/eliminar-cuenta.html`
- Sitio: `https://qsession.org/`
- Soporte de privacidad: `privacidad@qsession.org`

No registrar estas URLs en Play Console hasta comprobar que la versión web que las contiene ya está publicada.

## Ficha recomendada

**Nombre**<br>
Q Session

**Descripción corta**<br>
Audio y video en vivo para conectar experiencias en cualquier pantalla.

**Descripción completa**

Q Session convierte teléfonos, computadores y pantallas en una experiencia audiovisual compartida.

Únete a una transmisión con código, enlace o QR y recibe audio y video en vivo. Participa en silent parties, música, yoga y meditación, conferencias, bodas y encuentros privados desde cualquier lugar.

- Audio en vivo con reproducción en segundo plano.
- Video del anfitrión y cámaras autorizadas.
- Salas privadas por enlace, código o QR durante el lanzamiento inicial.
- Chat privado, grupal y de sala.
- Invitaciones por enlace, código y QR.
- Perfiles visibles o privados, bajo control del usuario.
- Global Rave: comparte únicamente tu país para encender el mapa, nunca tu ubicación exacta.

Q Session: baila, libera y conecta.

## Declaración de permisos

| Permiso o capacidad | Uso dentro de Q Session | Condición |
| --- | --- | --- |
| Cámara | Transmitir video, participar con cámara, foto de perfil y lectura de QR | Sólo después de una acción del usuario |
| Micrófono | Transmitir, hablar en llamadas y enviar notas de voz | Sólo después de una acción del usuario |
| Ubicación aproximada/precisa del sistema | Determinar localmente el país que el usuario decide aportar a Global Rave | Se envía el código de país; no se envían coordenadas |
| Notificaciones | Mostrar la transmisión activa, mensajes privados, llamadas entrantes y controles de reproducción | Android 13 o posterior solicita permiso |
| Bluetooth | Detectar o conservar la salida de audio elegida | Android 12 o posterior |
| WakeLock y Wi-Fi lock | Mantener audio en vivo durante pantalla apagada | Sólo mientras el servicio de reproducción está activo |

No se solicita `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` en la candidata de Play.

## Servicios en primer plano

Play Console debe declarar estos dos tipos:

### Reproducción multimedia (`mediaPlayback`)

**Descripción sugerida:** Q Session mantiene el audio de una sala en vivo mientras la pantalla está apagada o la persona usa otra aplicación. El servicio muestra una notificación persistente con el nombre de la sala y controles, y termina cuando la persona sale o detiene la reproducción.

**Video de demostración:** entrar con un código, iniciar audio, bloquear la pantalla, mostrar que el audio continúa y detenerlo desde la notificación o al salir de la sala.

### Micrófono (`microphone`)

**Descripción sugerida:** cuando un anfitrión inicia voluntariamente una transmisión, Q Session mantiene el micrófono activo mediante un servicio visible. No se inicia en segundo plano ni sin una acción explícita.

**Video de demostración:** crear/abrir sala como anfitrión, conceder micrófono, iniciar transmisión, mostrar la notificación y finalizarla.

## Data Safety: inventario para revisar en Play Console

La respuesta definitiva debe coincidir con la configuración productiva activa. Inventario conservador:

| Categoría de Play | Datos | Uso principal | Eliminable |
| --- | --- | --- | --- |
| Información personal | Correo, nombre visible, identificador de cuenta | Cuenta, autenticación y perfiles | Sí |
| Fotos y videos | Perfil y archivos enviados voluntariamente | Perfil, chat y saludos | Sí |
| Audio | Transmisión y notas de voz voluntarias | Experiencia en vivo y chat | Sí |
| Mensajes | Chat privado, grupal y de sala | Comunicación solicitada | Sí |
| Ubicación aproximada | Código de país compartido voluntariamente | Global Rave | Sí |
| Actividad en la app | Salas, ingresos, funciones y eventos técnicos | Operación, seguridad y métricas | Parcial/según obligación |
| Historial de compras | Plan, valor, referencia y estado | Bonos, soporte y contabilidad | Anonimizado según obligación |
| Diagnóstico | Fallos y datos técnicos limitados | Estabilidad y seguridad | Según retención técnica |

Confirmar en el formulario:

- datos cifrados durante el tránsito: **sí**;
- solicitud de eliminación: **sí**, dentro de Perfil y en la URL pública;
- venta de datos personales: **no**;
- coordenadas GPS exactas transmitidas al servidor: **no**;
- números completos de tarjeta o claves bancarias almacenados por Q Session: **no**.

## Acceso para revisión

Play necesita una cuenta de revisión funcional y una sala de demostración. Preparar antes de enviar:

1. Cuenta de prueba sin datos personales reales.
2. Contraseña vigente y estable durante toda la revisión.
3. Código o enlace de una sala que pueda abrirse sin depender de un evento puntual.
4. Instrucciones breves para probar audio en segundo plano, cámara, micrófono, QR y Global Rave.
5. Si la creación de sala exige bono, asignar un bono gratuito a esa cuenta desde Administración.

## Secuencia en Play Console

1. Crear la aplicación y aceptar Play App Signing.
2. Cargar el AAB en Prueba interna para el primer análisis automático.
3. Copiar el SHA-256 del **certificado de firma de la aplicación** de Play Console.
4. Agregar ese certificado a `public/.well-known/assetlinks.json` sin quitar la firma de carga actual; publicar el archivo y comprobar App Links.
5. Completar Acceso a la app, Anuncios, Clasificación de contenido, Público objetivo, Seguridad de datos y Aplicaciones gubernamentales/financieras según corresponda.
6. Registrar las dos declaraciones de servicio en primer plano y sus videos.
7. Subir icono de ficha de 512×512, gráfico de 1024×500, capturas de teléfono y datos de contacto.
8. Publicar una prueba cerrada. Si la cuenta personal fue creada después del 13 de noviembre de 2023, mantener al menos 12 participantes durante 14 días continuos antes de solicitar producción.

## Pendientes que requieren cuenta externa

- Crear o verificar la cuenta de desarrollador de Google Play.
- Conocer si la cuenta está sujeta a la prueba cerrada de 12 personas/14 días.
- Obtener el certificado de firma que Play genera después de cargar el primer AAB.
- Confirmar que `privacidad@qsession.org` recibe mensajes o configurar su reenvío.
- Capturar los videos de justificación de los servicios en primer plano.
- Integrar Google Play Billing antes de permitir compras digitales dentro de Android.
- Conectar Firebase Cloud Messaging para entregar mensajes y llamadas cuando Android haya cerrado completamente el proceso de Q Session.
