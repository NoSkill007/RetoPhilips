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

Cada extracción se valida contra un schema estricto, el catálogo de modalidades y la cláusula del relato asociada a cada equipo. Los valores sin respaldo se rechazan. Si la primera salida de QVAC es inválida, SiteSignal hace un único reintento con instrucciones correctivas. Después del reintento puede conservar una extracción parcial cuando aún existen un hospital y una modalidad respaldados; los rechazos permanecen visibles y los campos dudosos quedan vacíos para revisión. Si no queda una extracción útil, abre tarjetas vacías, conserva el relato original y registra procedencia `Manual`.

SiteSignal formula hasta tres preguntas, una por vez, en este orden: hospital, modalidad, cantidad, fabricante, modelo y antigüedad. Cada una permite responder “No lo sé”. Los campos se muestran como Confirmado, Reportado, Estimado o Desconocido; el estado general toma el más débil entre hospital, modalidad y cantidad.

La confianza suma hasta 40 puntos de completitud (hospital 8; por equipo: modalidad 8, cantidad 8, fabricante 5, modelo 5 y antigüedad 6), 25 de vigencia que disminuyen linealmente hasta cero al cumplir doce meses y 35 según la proporción de esos campos respaldada por evidencia o confirmación independiente. Las bandas son Baja 0–49, Media 50–79 y Alta 80–100. El número de serie y el área conservan su estado, pero no reducen el puntaje porque pueden no aplicar.

Una cantidad conjunta se incorpora a la base instalada como un grupo, sin crear números de serie ni identidades ficticias. Para identificar una unidad, registra una nueva observación con cantidad 1 y número de serie, selecciona el hospital existente y relaciónala con el grupo durante la revisión. La unidad conserva la observación original y la nueva como procedencia; el grupo restante mantiene su fuente y reduce su cantidad sin alterar el total.

SiteSignal presenta una serie idéntica como coincidencia fuerte. Sin serie, sugiere candidatos cuando coinciden el hospital, la modalidad y al menos otro dato entre fabricante, modelo, cantidad o antigüedad aproximada. La comparación muestra coincidencias y diferencias; solo una decisión explícita permite consolidar. Conservar separados no modifica la base instalada, mientras que consolidar elimina el conteo duplicado y mantiene todas las observaciones originales.

Las observaciones incompatibles sobre un equipo con la misma serie permanecen visibles como conflictos pendientes. Resolver exige seleccionar uno de los valores respaldados y escribir una explicación. Las correcciones de la base instalada registran valor anterior, valor nuevo, perfil, fecha y motivo, y permanecen como datos reportados. Una coincidencia entre observaciones de perfiles distintos confirma únicamente los campos que ambas respaldan. El historial se presenta separado de la proyección actual y persiste en SQLite.

El panorama regional precarga un dataset determinista de diez hospitales y sesenta equipos ficticios en Panamá, Brasil y Colombia. Resume hospitales, equipos, confianza, información desactualizada y oportunidades potenciales; permite filtrar por cliente, hospital, país, ciudad y modalidad. El mapa vectorial, los gráficos y los demás recursos son locales. Las capturas guardadas se incorporan al panorama y se distinguen del dataset precargado; restablecer la demostración no elimina esas capturas.

Variables opcionales: `SITESIGNAL_PORT` (1–65535), `SITESIGNAL_DATA` (directorio de almacenamiento). `SITESIGNAL_MODEL` debe configurarse en cada terminal nueva o persistirse mediante la configuración de entorno de Windows. Un modelo ausente permite abrir la interfaz con instrucciones de recuperación; un puerto ocupado o almacenamiento sin permisos impide arrancar y produce un mensaje en terminal. No se modifica ni elimina la base existente.

## Validación

```powershell
npm run typecheck
npm test
```

Las pruebas consultan la API HTTP con SQLite temporal real y un adaptador de texto determinista. Para comprobar la extracción real en español e inglés, configura `SITESIGNAL_MODEL` y ejecuta `npm run qvac:check:text`. Las respuestas varían según el modelo y siempre pasan por una revisión humana antes de guardarse. La prueba completa con la red deshabilitada corresponde a la entrega final.

## Origen

Antes de esta implementación existían la especificación y tickets, los documentos de dominio y agentes, la configuración npm/QVAC y `quickstart.js`, un experimento de inferencia. La interfaz y servidor local se desarrollaron con asistencia de Codex. Todo dato de demostración debe ser sintético. No se incluye información de pacientes o clientes reales.
