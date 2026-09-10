# SiteSignal

Prototipo local de inteligencia de base instalada. Esta entrega implementa el arranque (#2); la captura de observaciones todavía no está disponible.

## Preparación en Windows (con conexión)

1. Instala Node.js 24 o superior (probado con 26.7.0). Abre PowerShell en este repositorio.
2. Ejecuta `npm ci`.
3. Ejecuta `npx qvac doctor` y comprueba la disponibilidad del runtime.
4. Descarga un modelo GGUF de texto compatible con QVAC. La exploración existente `npm run qvac:test` descarga Llama 3.2 1B Q4 en la caché de QVAC y realiza una inferencia. Este modelo permite comprobar el arranque; no está validado para extracción fiable.
5. Configura la ruta absoluta del archivo descargado, por ejemplo:

```powershell
$env:SITESIGNAL_MODEL = 'C:\ruta\al\modelo.gguf'
.\Start-SiteSignal.ps1
```

Si PowerShell bloquea scripts, usa `powershell -ExecutionPolicy Bypass -File .\Start-SiteSignal.ps1` para esa ejecución. El iniciador abre el navegador una vez que el servidor escucha. También puedes usar `npm start` y abrir la URL indicada manualmente.

## Uso local

La API y todos los recursos de interfaz se sirven desde `http://127.0.0.1:3210`. No hay fuentes, mapas ni scripts alojados en CDN. El arranque usa exclusivamente la ruta del modelo local; no descarga pesos. QVAC se carga en un proceso aislado y se libera tras la comprobación, con un límite de 60 segundos. «Disponible» significa que el modelo pudo cargarse, no que su extracción haya sido validada ni que se haya demostrado desconexión de red.

SQLite se crea en `data/sitesignal.db`, relativo al repositorio, y conserva el identificador de instalación y el contador de arranques. Detén con Ctrl+C. Para verificar persistencia, reinicia y compara el identificador y contador visibles.

Variables opcionales: `SITESIGNAL_PORT` (1–65535), `SITESIGNAL_DATA` (directorio de almacenamiento). `SITESIGNAL_MODEL` debe configurarse en cada terminal nueva o persistirse mediante la configuración de entorno de Windows. Un modelo ausente permite abrir la interfaz con instrucciones de recuperación; un puerto ocupado o almacenamiento sin permisos impide arrancar y produce un mensaje en terminal. No se modifica ni elimina la base existente.

## Validación

```powershell
npm run typecheck
npm test
```

Las pruebas consultan la API HTTP con SQLite temporal real y adaptadores de IA deterministas. Para comprobar QVAC real, configura `SITESIGNAL_MODEL`, ejecuta el iniciador y espera el resultado del panel. La prueba completa de extracción sin conexión corresponde a las siguientes entregas.

## Origen

Antes de esta implementación existían la especificación y tickets, los documentos de dominio y agentes, la configuración npm/QVAC y `quickstart.js`, un experimento de inferencia. La interfaz y servidor local se desarrollaron con asistencia de Codex. Todo dato de demostración debe ser sintético. No se incluye información de pacientes o clientes reales.
