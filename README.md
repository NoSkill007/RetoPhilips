# SiteSignal

Prototipo local de inteligencia de base instalada. Permite capturar una observación escrita, revisar la extracción local de QVAC y consultar su procedencia en el perfil 360 del hospital.

## Preparación en Windows (con conexión)

1. Instala Node.js 24 o superior (probado con 26.7.0). Abre PowerShell en este repositorio.
2. Ejecuta `npm ci`.
3. Ejecuta `npx qvac doctor` y comprueba la disponibilidad del runtime.
4. Ejecuta `npm run qvac:prepare:text`. Esto descarga Qwen3 4B Q4_K_M (aproximadamente 2.5 GB), lo carga mediante QVAC y muestra la ruta local exacta. Haz este paso antes de desconectarte.
5. Configura la ruta mostrada, por ejemplo:

```powershell
$env:SITESIGNAL_MODEL = 'C:\Users\tu-usuario\.qvac\models\archivo_Qwen3-4B-Q4_K_M.gguf'
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

Las pruebas consultan la API HTTP con SQLite temporal real y un adaptador de texto determinista. Para comprobar la extracción real en español e inglés, configura `SITESIGNAL_MODEL` y ejecuta `npm run qvac:check:text`. Las respuestas varían según el modelo y siempre pasan por una revisión humana antes de guardarse. La prueba completa con la red deshabilitada corresponde a la entrega final.

## Origen

Antes de esta implementación existían la especificación y tickets, los documentos de dominio y agentes, la configuración npm/QVAC y `quickstart.js`, un experimento de inferencia. La interfaz y servidor local se desarrollaron con asistencia de Codex. Todo dato de demostración debe ser sintético. No se incluye información de pacientes o clientes reales.
