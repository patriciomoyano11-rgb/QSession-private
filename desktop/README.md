# Q Session Desktop

Aplicaciones nativas para que un anfitrión publique una sesión de Q Session con
una conexión más estable que la pestaña de un navegador.

## Plataformas

- **Windows:** aplicación híbrida que muestra la experiencia web completa de
  Q Session con el mismo diseño, navegación y funciones. El estudio WPF nativo
  sigue disponible desde la pantalla de recuperación cuando falla la conexión;
  el acceso de la barra está retirado por ahora. Este estudio captura la salida de
  Windows o una entrada física mediante WASAPI y publica audio/cámara con
  LiveKit.
- **macOS:** aplicación SwiftUI con el mismo contrato de salas y estado. La capa
  audiovisual usa CoreAudio/ScreenCaptureKit y LiveKit Swift; se compila, prueba
  y firma desde una Mac con Xcode.

Las dos ediciones son el mismo producto: crean salas en `qsession.org`, reciben
credenciales efímeras del mismo endpoint y permiten que los oyentes continúen
entrando desde el navegador o desde futuras aplicaciones móviles.

## Qué resuelve la edición de escritorio

- La transmisión sigue activa al minimizar la ventana o usar otra aplicación.
- La ventana conserva el motor de Chrome para la captura y se identifica ante
  Windows con el logo y la identidad propios de Q Session en la barra de tareas.
- Permite elegir una pestaña de Chrome y publicar únicamente su audio, sin
  mezclar notificaciones ni el sonido de otras aplicaciones.
- La interfaz web integrada delega esa selección a una ventana real de Chrome;
  WebView2 conserva la cámara y los controles, pero no intenta capturar una
  pestaña que su selector no puede ofrecer.
- La pestaña de Chrome vuelve a ser la fuente predeterminada para las nuevas
  salas y se publica en estéreo, a 48 kHz, sin procesamiento de voz.
- Abre una ventana normal y aislada de Chrome para que el selector priorice
  `Pestaña de Chrome`, no una ventana ni la pantalla completa.
- Después de la confirmación protegida de Chrome, oculta automáticamente la
  ventana auxiliar; la captura continúa activa y se puede volver a mostrar
  desde el control nativo para cambiar de pestaña.
- Evita que el navegador suspenda la captura por estar en segundo plano.
- Recupera una sala después de un cierre inesperado sin guardar la credencial
  del anfitrión en texto visible.
- Solicita una credencial multimedia nueva y reconecta automáticamente cuando
  se corta Internet.
- Incluye su propio motor audiovisual nativo, sus binarios LiveKit y su proceso
  de compilación; no necesita fuentes ni artefactos de otro producto.

## Windows

Desde PowerShell:

```powershell
.\desktop\windows\build.ps1
```

El ejecutable de desarrollo queda en
`desktop/build/windows-x64/QSession.Host.exe`. La descarga pública debe
usar `desktop/build/Instalar-QSession-Windows.exe`: es un único archivo
que instala Q Session dentro del perfil local de Windows, crea accesos directos
en el escritorio y el menú Inicio, y abre la aplicación al finalizar. No exige
extraer una carpeta ni privilegios de administrador.

## macOS

La base está en `macos/QSessionHost`. Requiere macOS, Xcode 16 o posterior y una
identidad de firma de Apple para producir la aplicación distribuible. Consulta
el README de esa carpeta.

## Seguridad

La aplicación no registra credenciales multimedia. El control de recuperación
de la sala se cifra con la protección del usuario de Windows (DPAPI) o con
Keychain en macOS. Detener la transmisión archiva la sala y elimina el control
local.
