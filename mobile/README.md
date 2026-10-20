# Q Session Mobile

Aplicación oficial de Q Session para Android e iOS. Android muestra la interfaz
canónica de `qsession.org` dentro de un contenedor nativo, mientras LiveKit, el
audio, la reconexión y el servicio en segundo plano se ejecutan fuera de esa
interfaz. Así En vivo, Personas, Chat y Global conservan paridad exacta con la
web sin entregar la continuidad del audio al navegador.

## Arquitectura

- `src/core`: contrato compartido con la web, Windows y macOS. No contiene
  comportamiento específico de Android ni de Apple.
- `src`: experiencia móvil compartida, perfiles, chat y clientes LiveKit.
- `android`: actividad nativa con la interfaz web canónica, motor React Native
  LiveKit oculto y servicio de primer plano. La presentación puede suspenderse
  al bloquear la pantalla; la conexión de audio mantiene sus propios bloqueos
  de CPU/Wi-Fi y su ciclo de reconexión.
- `ios`: proyecto Xcode preparado para audio en segundo plano, cámara,
  micrófono y enlaces `qsession://join`.

Producción usa exclusivamente `https://qsession.org`. El servidor crea el
código de seis caracteres; la app nunca inventa una sala local ni mezcla una
clave del sistema anterior con una sala Q Session.

## Enlaces de invitación en Android

Android declara `https://qsession.org` como App Link verificado. Un enlace de
invitación como `https://qsession.org/?room=ABC123` abre la app instalada y la
app entrega ese mismo enlace a la interfaz de Q Session, que entra a la sala.
Si la app no está instalada, el enlace continúa funcionando en el navegador.

Para activar la verificación en producción, el servidor debe publicar
`https://qsession.org/.well-known/assetlinks.json` con el paquete
`org.qsession.app` y la huella SHA-256 de la clave privada que firma la APK de
producción. Esa huella debe corresponder exactamente a la APK descargable; no
se debe asociar el dominio con una clave de depuración.

## Desarrollo

Requisitos comunes: Node.js 20 o posterior y pnpm.

Android requiere Java 17 y Android SDK:

```powershell
pnpm install
pnpm test -- --runInBand
pnpm exec tsc --noEmit
pnpm android
```

En Android 13 o posterior, el permiso opcional de notificaciones sólo se pide
una vez que la persona acumula 24 horas reales de uso con Q Session en primer
plano. El tiempo se conserva entre aperturas y no incluye el uso en segundo
plano.

iOS requiere macOS, Xcode y CocoaPods:

```bash
pnpm install
cd ios && bundle exec pod install && cd ..
pnpm ios
```

El proyecto iOS se desarrolla y firma en un Mac, pero consume exactamente el
mismo código TypeScript y los mismos endpoints que Android.

## Publicación

Android `release` exige `android/signing.properties`; la clave de producción se
mantiene fuera del repositorio. iOS usa el identificador `org.qsession.app` y
debe firmarse con la cuenta Apple Developer de Q Session.

Para Android, ejecuta `mobile/android/publish-release.ps1` desde Windows. El proceso compila la
APK firmada, copia el artefacto con su versión y actualiza
`platform/public/app-releases.json`, incluyendo tamaño y huella SHA-256. No
edites a mano la URL de descarga en la interfaz.

No publiques tokens, `signing.properties`, archivos `.jks`, perfiles reales,
APK/IPA ni credenciales de servidor.
