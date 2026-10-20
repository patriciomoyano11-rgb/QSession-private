# Q Session

Q Session es una plataforma unificada con base técnica propia. La interfaz, las
cuentas, los perfiles y los contratos de salas pertenecen a un único núcleo. Web,
Android y Windows consumen el mismo producto y sólo agregan un puente nativo cuando
el sistema operativo lo exige.

## Beta pública

La base web instalable está publicada en `https://qsession.org`. Se ejecuta como un
servicio independiente, con puerto, secretos, volumen de datos y pila multimedia
propios. Las salas usan el prefijo `qsession-` y no dependen de otro producto.

## Administración y métricas

El panel privado se abre en `https://qsession.org/admin`. Usa credenciales
administrativas independientes de las cuentas públicas y resume por separado web,
Android y Windows: usuarios anónimos, visitas, funciones, versiones, salas,
interacciones y calidad de conexión. No almacena IP, contraseñas, mensajes ni
contenido audiovisual.

Configura `QSESSION_ADMIN_USERNAME`, `QSESSION_ADMIN_PASSWORD_HASH`,
`QSESSION_ADMIN_SESSION_SECRET`, `QSESSION_ANALYTICS_SECRET` y
`QSESSION_ANALYTICS_DATA_FILE`. La contraseña debe convertirse con `hashPassword`
de `product-store.js`; sólo el hash se copia al servidor.

## Salas públicas, privadas y protección de contenido

La configuración de producción habilita el directorio con
`QSESSION_PUBLIC_ROOMS_ENABLED=true`. El anfitrión puede crear una sala pública,
visible cuando transmita, o conservarla privada por enlace, código o QR. Las
salas públicas deben usar el catálogo original administrado por Qsession o
contenido propio o debidamente autorizado. Cada creación exige una declaración
expresa de titularidad o autorización y conserva la cuenta, fuente, fecha,
modalidad de visibilidad y activo relacionado para auditoría.

Los términos para anfitriones, la política de propiedad intelectual y el canal
de reporte/apelación están publicados en `/terminos-anfitriones.html`,
`/propiedad-intelectual.html` y `/reportar-contenido.html`. El panel
administrativo permite revisar cada caso, detener la sala, confirmar o revertir
una sanción. Tres sanciones activas suspenden la cuenta; una decisión revertida
deja de contar y puede reactivar la cuenta. La apertura pública no convierte en
libre contenido de terceros: mantenga revisión de catálogo, moderación,
privacidad y atención de reportes en cada territorio donde opere Qsession.

## Primera base

- Acceso mundial por HTTPS; nunca depende de compartir Wi‑Fi con el DJ.
- Salas multimedia mediante una dirección pública segura entregada por la API.
- Cuenta opcional para escuchar o transmitir, pero obligatoria para guardar Perfil.
- Perfil DJ u oyente, privacidad explícita y galería de hasta seis fotos.
- Catálogo musical propio, biblioteca editorial y Autopiloto DJ.
- Símbolo Q único derivado del logotipo aprobado.

## Descargas oficiales

La interfaz consulta `/api/app-releases` sin caché. Las rutas permanentes
`/downloads/QSession-Android-latest.apk` y
`/downloads/QSession-Windows-latest.exe` redirigen al artefacto validado por el
servidor. No se deben escribir números de versión directamente en `app.js`.

`mobile/android/publish-release.ps1` compila y registra Android. El proceso
`desktop/windows/build.ps1` hace lo mismo para Windows. Ambos llaman a
`scripts/update-app-release.cjs`, que sincroniza versión, archivo, tamaño y
SHA-256 en `public/app-releases.json`. Una publicación debe incluir juntos el
catálogo y los instaladores que referencia.

Para desarrollo local: `node server.js`. La ruta de crecimiento a 5.000 personas
usa WebSocket para el chat, Redis para distribuir eventos, PostgreSQL para el
historial y cargas directas para videos. El modo de archivo continúa disponible en
desarrollo y durante la migración; consulta `ARCHITECTURE.md` antes de activar la
entrega masiva por CDN.

## Activar la entrega para 5.000 personas

1. Crea un bucket privado `qsession-live` y otro `qsession-live-preview` en
   Cloudflare R2. Aplica una regla de ciclo de vida de 24 horas al prefijo `live/`.
2. Despliega `edge/hls-worker.js`, enlaza el bucket como `QSESSION_LIVE` y conecta
   `live.qsession.org` como dominio personalizado.
3. Crea una credencial S3 limitada únicamente a ese bucket y completa
   `QSESSION_BROADCAST_STORAGE_ENDPOINT`, `..._ACCESS_KEY` y `..._SECRET_KEY` en
   `deploy/qsession.env`. Nunca uses una llave con acceso global a la cuenta.
4. Genera `deploy/egress.yaml` con `render-config.js` y levanta la pila. El proceso
   Egress requiere cerca de 3 CPU por sala mezclada; usa 4 vCPU o un nodo separado.
5. Verifica en `/api/status` que `deliveryMode` sea `object-storage`; si muestra
   `local-origin`, R2 todavía no está activo y el tráfico sigue saliendo del VPS.
6. Ejecuta primero una prueba cerrada y después `pnpm test:realtime-load` antes de
   anunciar el límite. Si R2 no está configurado o HLS falla, el oyente conserva la
   ruta WebRTC actual.

## Biblioteca musical

La biblioteca pública usa por defecto únicamente el catálogo propio cargado por QSession. La antigua selección editorial de Audius se conserva como referencia técnica desactivada y no se publica ni se ofrece para reproducción. Consulta [integración y mantenimiento](docs/AUDIUS.md).

La cuenta administradora también puede abrir **Biblioteca**, elegir **Importar
carpeta** y cargar un catálogo original completo. Qsession acepta MP3, WAV, M4A,
AAC, OGG y FLAC, valida archivos de hasta cuatro horas y 180 MB, evita duplicados
por huella SHA-256 y conserva los audios fuera de la carpeta pública. El catálogo
se guarda en `QSESSION_ORIGINAL_MUSIC_DIR` (por defecto, `/data/original-music` en
Docker), que debe mantenerse en un volumen persistente y dentro de las copias de
seguridad.

La clasificación inicial usa nombres de carpetas, archivos y metadatos para
proponer género, subgénero y energía. Las pistas dudosas quedan marcadas para
revisión y se pueden corregir desde la propia biblioteca. Esta ayuda editorial no
determina derechos: antes de importar, la administración debe comprobar que el
contenido es propio o que cuenta con autorización suficiente para el uso previsto.

El **Autopiloto DJ** construye una cola por género, duración y curva de energía,
evita repetir el historial reciente y prepara el siguiente bloque al terminar la
cola. El audio puede escucharse localmente o enviarse como fuente de la sala con el
flujo de transmisión existente.
