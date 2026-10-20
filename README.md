# Q Session

Repositorio independiente del producto Q Session.

- `platform/`: web, API, cuentas, perfiles, salas, chat y administración.
- `mobile/`: aplicación móvil React Native para Android e iOS.
- `desktop/`: aplicaciones de escritorio y motor multimedia nativo propio.
- `docs/`: documentación funcional y técnica.
- `releases/`: compilaciones locales; no se guardan en Git.
- `private/`: firma y recuperación local; nunca se guarda en Git.

La pila de producción independiente está en `platform/deploy/`. Q Session usa
datos, secretos, Redis, LiveKit, TURN y proxy propios. Ninguna compilación requiere
rutas, binarios, servicios o configuraciones externas a este repositorio.

## Verificación

Desde esta carpeta:

```powershell
& '.\mobile\node_modules\.bin\tsc.cmd' --noEmit
& '.\mobile\node_modules\.bin\jest.cmd' --runInBand
& '.\desktop\native-media\tools\build-native.ps1' -Configuration Release
& '.\desktop\windows\build.ps1'
```

La plataforma se prueba con Node.js mediante `node --test platform/test/*.test.js`.
