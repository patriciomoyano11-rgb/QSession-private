# Q Session Desktop para Mac

Esta carpeta contiene la edición SwiftUI del anfitrión. Comparte el contrato de
salas, el diseño de estados y la recuperación segura con Windows.

## Estado de esta primera entrega

- Crear sala pública o privada en `qsession.org`.
- Publicar micrófono y cámara con el SDK nativo de LiveKit.
- Guardar el control de recuperación en Keychain.
- Reconexión de transporte gestionada por el SDK de LiveKit.
- Interfaz preparada para añadir captura del audio del sistema mediante
  ScreenCaptureKit/CoreAudio.

La captura completa del sonido de otras aplicaciones necesita el permiso
**Grabación de pantalla y audio del sistema** de macOS y se terminará y probará
en hardware Apple. No se debe prometer esa fuente hasta validar el adaptador en
una Mac real.

## Compilar

1. En una Mac con Xcode 16 o posterior, abre `QSessionHost/Package.swift`.
2. Permite que Swift Package Manager descargue LiveKit.
3. Selecciona el esquema `QSessionHost` y ejecuta.
4. Para distribución, crea el archivo firmado con el identificador
   `org.qsession.host` y habilita Camera, Microphone y App Sandbox/Network.

LiveKit se integra mediante Swift Package Manager 2.16.x, según la guía oficial
del SDK. La publicación para terceros requiere una cuenta Apple Developer.
