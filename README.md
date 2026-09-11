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

La API y todos los recursos de interfaz se sirven desde `http://127.0.0.1:3210`. Leaflet, los estilos y los scripts son locales. La única petición externa opcional durante la ejecución son las teselas del mapa base de OpenStreetMap; si no hay conexión, los marcadores y el resto de SiteSignal continúan funcionando sobre un fondo neutro. El arranque usa exclusivamente las rutas de los modelos locales y no descarga pesos.

SQLite se crea en `data/sitesignal.db`, relativo al repositorio, y conserva el identificador de instalación y el contador de arranques. Detén con Ctrl+C. Para verificar persistencia, reinicia y compara el identificador y contador visibles.

Cada extracción se valida contra un schema estricto, el catálogo de modalidades y la cláusula del relato asociada a cada equipo. Los valores sin respaldo se rechazan. Si la primera salida de QVAC es inválida, SiteSignal hace un único reintento con instrucciones correctivas. Después del reintento puede conservar una extracción parcial cuando aún existen un hospital y una modalidad respaldados; los rechazos permanecen visibles y los campos dudosos quedan vacíos para revisión. Si no queda una extracción útil, abre tarjetas vacías, conserva el relato original y registra procedencia `Manual`.

SiteSignal formula hasta tres preguntas, una por vez, en este orden: hospital, modalidad, cantidad, fabricante, modelo y antigüedad. Cada una permite responder “No lo sé”. Los campos se muestran como Confirmado, Reportado, Estimado o Desconocido; el estado general toma el más débil entre hospital, modalidad y cantidad.

La confianza suma hasta 40 puntos de completitud (hospital 8; por equipo: modalidad 8, cantidad 8, fabricante 5, modelo 5 y antigüedad 6), 25 de vigencia que disminuyen linealmente hasta cero al cumplir doce meses y 35 según la proporción de esos campos respaldada por evidencia o confirmación independiente. Las bandas son Baja 0–49, Media 50–79 y Alta 80–100. El número de serie y el área conservan su estado, pero no reducen el puntaje porque pueden no aplicar.

Una cantidad conjunta se incorpora a la base instalada como un grupo, sin crear números de serie ni identidades ficticias. Para identificar una unidad, registra una nueva observación con cantidad 1 y número de serie, selecciona el hospital existente y relaciónala con el grupo durante la revisión. La unidad conserva la observación original y la nueva como procedencia; el grupo restante mantiene su fuente y reduce su cantidad sin alterar el total.

SiteSignal presenta una serie idéntica como coincidencia fuerte. Sin serie, sugiere candidatos cuando coinciden el hospital, la modalidad y al menos otro dato entre fabricante, modelo, cantidad o antigüedad aproximada. La comparación muestra coincidencias y diferencias; solo una decisión explícita permite consolidar. Conservar separados no modifica la base instalada, mientras que consolidar elimina el conteo duplicado y mantiene todas las observaciones originales.

Las observaciones incompatibles sobre un equipo con la misma serie permanecen visibles como conflictos pendientes. Resolver exige seleccionar uno de los valores respaldados y escribir una explicación. Las correcciones de la base instalada registran valor anterior, valor nuevo, perfil, fecha y motivo, y permanecen como datos reportados. Una coincidencia entre observaciones de perfiles distintos confirma únicamente los campos que ambas respaldan. El historial se presenta separado de la proyección actual y persiste en SQLite.

El panorama regional precarga un dataset determinista de doce hospitales y setenta y dos equipos ficticios en cinco países (Panamá, Brasil, Colombia, México y Chile). El hospital, el cliente y los colaboradores son enteramente ficticios, pero el fabricante y modelo de cada equipo (`src/regional-panorama.js`, `equipmentCatalog`) usan marcas reales del sector médico (Philips, GE Healthcare, Siemens Healthineers, Canon Medical, Mindray) con un modelo plausible por modalidad — son nombres públicos de productos comerciales, no información de ningún paciente o cliente, y hacen que la base instalada de demostración se lea como una real en vez de con marcadores genéricos repetidos. Resume hospitales, equipos, confianza, información desactualizada y oportunidades potenciales; permite filtrar por cliente, hospital, región, país, ciudad y modalidad. Un mapa Leaflet muestra cada hospital mediante coordenadas aproximadas resueltas desde un catálogo local, sin geocodificación en línea. Cada país se agrupa además bajo una Región, siguiendo la jerarquía Región → País → Ciudad → Cliente. Las capturas guardadas se incorporan al panorama y se distinguen del dataset precargado; restablecer la demostración no elimina esas capturas.

Cada observación revisada admite un comentario libre opcional (hasta 1000 caracteres) — una nota propia del colaborador, nunca validada contra el relato ni usada para calcular la confianza. También se distingue el canal de captura (texto escrito o dictado por voz) en la procedencia de cada observación, visible en la revisión y en el perfil 360 del hospital.

También puedes preguntar al panorama en español o inglés. QVAC interpreta únicamente filtros visibles de ubicación, cliente, hospital, modalidad, antigüedad aproximada, estado, confianza y vigencia; el usuario puede editarlos o quitarlos antes de continuar. SiteSignal valida esos valores contra el catálogo local y contra las palabras de la pregunta, muestra la procedencia y explica el resultado. Las solicitudes ambiguas o no compatibles no aplican filtros, y el modelo nunca genera ni ejecuta SQL.

Variables opcionales: `SITESIGNAL_PORT` (1–65535), `SITESIGNAL_DATA` (directorio de almacenamiento). `SITESIGNAL_MODEL` debe configurarse en cada terminal nueva o persistirse mediante la configuración de entorno de Windows. Un modelo ausente permite abrir la interfaz con instrucciones de recuperación; un puerto ocupado o almacenamiento sin permisos impide arrancar y produce un mensaje en terminal. No se modifica ni elimina la base existente.

La sección "Estado del entorno" muestra, para cada modelo local (texto, voz, evidencia fotográfica): su estado de conexión, el archivo del modelo cargado, su cuantización (cuando el nombre del archivo la declara) y la duración de la última inferencia realizada en esta sesión. También declara el hardware local detectado (CPU y GPU, vía `getSystemResources` de QVAC) cuando puede consultarse; si no puede, la aplicación sigue funcionando con normalidad y solo omite ese dato.

Exportación: la misma sección ofrece "Exportar base instalada (CSV)" (`GET /api/export/installed-base.csv`) y "Exportar observaciones y evidencia (JSON)" (`GET /api/export/state.json`). Ambas reflejan exactamente el estado visible en la aplicación en ese momento — nunca una copia rezagada — y cubren solo lo capturado localmente en esta instalación (el dataset ficticio precargado ya es reproducible desde el panorama y "Restablecer demo", por lo que no se duplica en el archivo). El CSV es una fila por equipo de la base instalada, con sus valores y el estado (Confirmado/Reportado/Estimado/Desconocido) de cada campo. El JSON incluye, por hospital, sus observaciones completas, la base instalada con sus conflictos y su historial de decisiones, las oportunidades de renovación y las referencias a la evidencia fotográfica vinculada (metadata y texto OCR, nunca los bytes de la imagen).

Dictado local: además de escribir, puedes grabar la observación desde el navegador (sección "Dictar la observación"), elegir español o inglés, y transcribirla en este equipo con QVAC (Whisper small multilingüe, con decodificación determinista: `temperature: 0`, `strategy: greedy`); ningún audio ni transcripción sale a un servicio en la nube. La transcripción llena el mismo cuadro de texto y sigue el mismo flujo de revisión, validación y guardado que la captura escrita. Requiere `npm run qvac:prepare:voice` (descarga `ggml-small-q8_0.bin`, ~264 MB) y configurar `SITESIGNAL_VOICE_MODEL` con la ruta mostrada. Sin esa variable, el dictado queda deshabilitado pero la captura escrita sigue funcionando con normalidad.

Evidencia fotográfica local: cada tarjeta de equipo del formulario de revisión permite adjuntar una foto de una placa o etiqueta ficticia. La imagen se procesa en este equipo con OCR local de QVAC (EasyOCR); un analizador determinista (sin LLM) busca las etiquetas conocidas de fabricante, modelo, número de serie y fecha de fabricación/instalación en el texto detectado y solo confirma un campo cuando el propio texto de la placa lo respalda. La imagen y los campos extraídos se guardan localmente y quedan enlazados a la observación; los campos con respaldo fotográfico llegan a estado Confirmado de forma directa. Requiere `npm run qvac:prepare:photo` (descarga el modelo de reconocimiento/detección de texto, ~98 MB en total) y configurar `SITESIGNAL_PLATE_MODEL` con la ruta mostrada. Sin esa variable, la evidencia fotográfica queda deshabilitada pero el resto de la captura sigue funcionando con normalidad.

## Validación

```powershell
npm run typecheck
npm test
```

Las pruebas consultan la API HTTP con SQLite temporal real y un adaptador de texto determinista. Para comprobar la extracción real en español e inglés, configura `SITESIGNAL_MODEL` y ejecuta `npm run qvac:check:text`. Las respuestas varían según el modelo y siempre pasan por una revisión humana antes de guardarse. La prueba completa con la red deshabilitada corresponde a la entrega final.

Para comprobar la transcripción de voz real, configura `SITESIGNAL_VOICE_MODEL` y ejecuta `npm run qvac:check:voice`; transcribe las dos muestras sintéticas incluidas en `test/fixtures/` (español e inglés, generadas localmente con la TTS de QVAC, sin voces ni datos reales).

Para comprobar la evidencia fotográfica real, configura `SITESIGNAL_PLATE_MODEL` y ejecuta `npm run qvac:check:photo`; analiza dos placas ficticias sintéticas incluidas en `test/fixtures/` (español e inglés) y muestra los campos extraídos.

## Preparación vs. arranque normal

La preparación (`npm ci`, `npx qvac doctor`, cada `npm run qvac:prepare:*`) requiere conexión y descarga los pesos de los modelos una sola vez a la caché local de QVAC (`~/.qvac/models`). El arranque normal solo lee esas rutas locales. El mapa base de OpenStreetMap es la única petición externa de la aplicación y es opcional; ninguna inferencia, observación, imagen, audio ni dato de la base instalada se envía a ese servicio.

## Ejecución sin conexión

Para comprobar que la aplicación funciona sin red una vez preparados los modelos: prepara los tres modelos con conexión, desconéctala y ejecuta `npm start` con las tres variables configuradas. Captura, revisión, voz, evidencia, consultas, perfiles y exportaciones siguen disponibles. El mapa muestra un aviso discreto porque no puede descargar las teselas; conserva los marcadores y sus ventanas sobre un fondo neutro.

## Garantías del prototipo frente a requisitos de producción

Este prototipo demuestra el flujo completo (captura, revisión, base instalada, panorama, exportación) con inferencia local y sin datos reales, pero **no** implementa controles de nivel de producción. En particular, no incluye: cifrado de la base SQLite en disco ni de los archivos exportados, control de acceso corporativo o autenticación multiusuario (el "perfil" es solo una etiqueta de procedencia local, no una identidad verificada), auditoría a prueba de manipulación, alta disponibilidad, ni un proceso de gestión de vulnerabilidades sobre las dependencias de terceros. Una implementación real requeriría añadir esos controles antes de manejar información de pacientes o clientes.

## Dependencias, modelos y hardware declarado

Dependencias de código: `@qvac/sdk` (motor de inferencia local), `zod` (validación de esquemas), `sharp` (procesamiento de imágenes 100% local, usado solo para ampliar una foto de evidencia pequeña antes del OCR — no envía ni recibe nada por red) y `leaflet` (mapa del panorama regional, servido desde este mismo origen vía `/vendor/leaflet/`; sus tiles son la única petición de red que hace la aplicación en ejecución, y son opcionales). Sin frameworks de frontend ni bundlers: HTML, CSS y JavaScript nativo (módulos ES) servidos directamente desde `public/`. Modelos QVAC usados: Qwen3 4B Instruct Q4_K_M (extracción de texto y consultas naturales), Whisper small Q8_0 multilingüe (dictado de voz), EasyOCR (`latin_g2` + detector `craft_mlt_25k`, evidencia fotográfica). Hardware de referencia con el que se probó este prototipo: AMD Ryzen 7 8845HS (8 núcleos físicos / 16 lógicos), 16 GB de RAM, GPU integrada AMD Radeon 780M — toda la inferencia corrió sobre CPU. La sección "Estado del entorno" de la aplicación declara el hardware detectado en cada equipo donde se ejecute.

## Origen

Antes de esta implementación existían la especificación y tickets, los documentos de dominio y agentes, la configuración npm/QVAC y `quickstart.js`, un experimento de inferencia. La interfaz y servidor local se desarrollaron con asistencia de Codex. Todo dato de demostración debe ser sintético. No se incluye información de pacientes o clientes reales.

Guion de demostración en 5 minutos: [`DEMO.md`](DEMO.md).
