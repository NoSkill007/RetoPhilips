# Continuidad de SiteSignal

Lee este archivo al retomar la implementación desde otro chat o modelo. Después consulta `AGENTS.md`, `CONTEXT.md`, `README.md` y el ticket local correspondiente; esos archivos son las fuentes de verdad para reglas, dominio, operación y alcance.

## Objetivo y decisiones vigentes

SiteSignal es un prototipo de hackathon para el track Philips. Convierte observaciones ficticias de ingenieros de servicio, vendedores y especialistas en una base instalada consultable. La solución aceptada es una aplicación web local para computadora; debe funcionar sin servicios de inferencia en la nube y usar QVAC local.

Las decisiones principales ya confirmadas son:

- Captura en español o inglés, siempre con datos ficticios y sin información de pacientes.
- Un perfil local por colaborador y rol; los roles conservan procedencia y no cambian permisos.
- Revisión humana obligatoria antes de guardar.
- Cliente → Hospital → Área opcional como jerarquía.
- Estados `Confirmado`, `Reportado`, `Estimado` y `Desconocido` según `CONTEXT.md`.
- SQLite local persistente y QVAC con Qwen3 4B Q4_K_M.
- Pruebas rápidas con adaptadores deterministas y pruebas aisladas con QVAC real.

## Estado implementado

Los tickets del arranque local a las consultas naturales están terminados:

| Ticket | Resultado | Commit principal |
|---|---|---|
| #2 | Arranque local, SQLite, diagnóstico de QVAC | `5c18f5e` |
| #3 | Captura escrita, revisión y perfil 360 | `b2a2535` |
| #4 | Validación, reintento y captura manual | `f9debc3` |
| #5 | Preguntas de seguimiento y confianza explicable | `07aa1d6` |
| #6 | Grupos y separación de equipos | `6cf5444` |
| #7 | Candidatos a duplicado y consolidación humana | `e491916` |
| #8 | Conflictos, correcciones e historial auditable | `3a07139`, `a3121dc` |
| #9 | Panorama regional offline | `4925691` |
| #10 | Consultas naturales seguras y filtros visibles | `aaedf66` |
| #11 | Oportunidades potenciales explicables | `04c0853` |
| #12 | Dictado y transcripción local | pendiente de commit |
| #13 | Evidencia fotográfica local (placas ficticias) | pendiente de commit |

El panorama incluye un dataset reiniciable de 10 hospitales y 60 equipos ficticios en Panamá, Brasil y Colombia. Sus filtros, mapa SVG local, métricas y agregaciones también incorporan las capturas locales sin permitir que “Restablecer demo” las borre. Los perfiles 360 ficticios son navegables desde la lista regional.

El ticket #10 permite escribir preguntas en español o inglés y convertirlas mediante QVAC en filtros visibles y editables de país, ciudad, cliente, hospital, modalidad, antigüedad, estado, confianza y vigencia. La API valida un contrato estricto, vuelve a comprobar que cada filtro aparezca en la pregunta y consulta únicamente el panorama local; nunca acepta SQL generado. Las intenciones ambiguas o no compatibles no aplican filtros. La consulta real `Show Brazilian customers with MR systems older than seven years` produjo los filtros de Brasil y resonancia magnética; el límite estricto “más de 7” se normaliza de forma determinista como antigüedad mínima de 8 años.

El commit `07393d4` corrige un fallo observado con QVAC real: el modelo devolvía ausencias como `"null"`/`"no specified"` y mezclaba afirmaciones válidas con otras sin respaldo. SiteSignal ahora normaliza esos marcadores, reintenta con errores concretos y conserva una extracción parcial solo cuando queda al menos un hospital y una modalidad respaldada. Los valores dudosos permanecen vacíos y visibles para revisión. La captura manual sigue siendo el último recurso cuando no queda una extracción útil.

Caso real de regresión usado:

> Estoy en Hospital DemoCare Pacific, en Ciudad de Panamá. Tienen dos resonadores magnéticos y un tomógrafo. Uno de los resonadores parece de unos ocho años, marca Siemens, pero el otro no alcancé a ver el modelo.

Con QVAC real, el resultado seguro conserva `DemoCare Pacific` y `Tomografía computarizada`; la descripción ambigua de los resonadores queda para revisión y no se convierte en cantidades inventadas. Una primera inferencia puede tardar alrededor de 30–40 segundos en este caso; las siguientes suelen ser más rápidas.

El ticket #11 agrega una señal explicable de oportunidad potencial de renovación por equipo individual/consolidado: antigüedad ≥7 años, confianza ≥60, observación de respaldo con menos de doce meses y sin conflicto pendiente sobre ningún campo del equipo. Cada condición se muestra con su detalle y las observaciones que la respaldan; un colaborador puede marcarla revisada o descartada con una nota, con historial auditable (`src/opportunities.js`). La señal se recalcula siempre en vivo (nunca se cachea), tanto para hospitales capturados como para el dataset ficticio. Tiene UI en el perfil 360 (`public/capture.js`, sección "Oportunidades potenciales de renovación").

Durante pruebas manuales con QVAC real tras el ticket #11 aparecieron varios huecos de extracción en lenguaje natural (no relacionados con el ticket, corregidos en la misma sesión, ver `src/observation-schema.js`):

- "Ecógrafo"/"ecografía" ahora se reconoce como modalidad Ultrasonido (antes solo "ultra"/"us").
- Fabricante/modelo mencionados sin la palabra "fabricante"/"modelo" (p. ej. "un GE Voluson", "un tomógrafo Toshiba") ahora se aceptan si están junto a la mención de la modalidad. El número de serie sigue exigiendo su etiqueta explícita por ser un campo de identidad.
- Área nombrada de forma natural ("sala de urgencias", "unidad de...", "servicio de...") ahora se acepta sin la palabra "área"/"departamento".
- Año de instalación ("instalado en 2018", "desde 2018") se convierte a antigüedad usando la fecha de captura de la observación, con protección contra confundir un número de cuatro dígitos cualquiera (p. ej. un número de serie) con un año.
- Un relato con un solo equipo ahora usa todo el texto como contexto de ese equipo (antes se cortaba en la primera oración), sin perder la protección que impide atribuirle a un equipo un dato de otra parte del relato (p. ej. el nombre del hospital) — ver la prueba "un dato presente en otro contexto no se atribuye al equipo".
- Una afirmación genuinamente ambigua en el propio relato (p. ej. "no estoy seguro de la marca, parecía Siemens o Philips") sigue quedando `Desconocido` a propósito; no es un bug.

Una segunda ronda de pruebas (50 relatos reales con QVAC, 25 en español y 25 en inglés, sin el prefijo "DemoCare") encontró y corrigió más huecos:

- El prompt de extracción (`src/text-worker.js`) nunca pedía ciudad ni país al modelo; ahora sí, y con eso pasaron de 0/50 a 47/50 y 41/50 respectivamente.
- "Resonador" (el aparato) no coincidía con el patrón de modalidad "resonancia" (el procedimiento); mismo tipo de bug que tomógrafo/tomografía, mismo arreglo (stem compartido).
- El ancla de etiqueta (`anchored()`) exigía palabra completa; "Centro Clínico" no coincidía con "clínica" por la inflexión. Ahora solo exige el inicio de la palabra.
- Lista de tipos de centro ampliada: instituto, policlínica, sanatorio, centro de salud (antes solo hospital/clínica/centro médico).
- Cuando el modelo intercambia "cliente" y "hospital" en un centro de un solo sitio (p. ej. hospital="La Paz, Bolivia", cliente="Hospital San Gabriel"), el nombre correcto se recupera de "cliente".
- La ventana de "etiqueta cerca del valor" (35 caracteres, sin restricción de qué hay en medio) dejaba que "Hospital San Gabriel en **La Paz, Bolivia**" anclara mal la ciudad como si fuera el hospital. Se acotó a un conector inmediato (de/del/la/el/the/of, sin nada más en medio).
- La distancia ciudad/país–hospital se medía desde el inicio del nombre del hospital; con nombres largos ("Instituto Radiológico del Sur") el país quedaba fuera de rango aunque viniera justo después. Ahora se mide desde el borde más cercano del nombre.
- Adjetivos descriptivos ("básico", "portátil", "moderno", "nuevo/viejo") ya no se aceptan como modelo de equipo solo por estar junto a la modalidad.
- Un país que el modelo infiere del contexto pero no aparece literalmente en el relato (p. ej. "Brazil" a partir de "São Paulo") sigue rechazándose correctamente; verificado como comportamiento esperado, no un hueco.

Estas correcciones vienen de leer el brief oficial de Philips (`doc-1788886999143-c967da0a.docx`, aportado por el usuario) y comparar sus ejemplos textuales contra el validador. El brief también pide capturar Ciudad y País como parte de "Customer" — se implementó en la misma sesión: `hospitals` ahora tiene columnas `city`/`country` (con migración segura para bases de datos ya existentes sin esas columnas), el schema y el validador los extraen con el mismo fallback de proximidad al nombre del hospital, y el panorama regional ya no muestra "Ubicación no informada"/"Ciudad no informada" para hospitales capturados que sí las reportaron.

El ticket #12 agrega dictado local: la sección "Dictar la observación" (`public/voice.js`, `public/index.html`) graba audio con `MediaRecorder`, lo decodifica y reencoda como WAV mono 16 bits en el propio navegador (evita depender de qué contenedor/códec haya elegido el navegador; whisper.cpp decodifica WAV directamente) y lo sube a `POST /api/transcriptions?language=es|en`. El servidor lo transcribe con QVAC (Whisper small Q8_0 multilingüe, `src/voice-worker.js` + `src/voice-runtime.js`, mismo patrón de proceso hijo/IPC que `text-runtime.js`) y devuelve `{transcript, metadata}`. La transcripción llena el mismo `#observation` y sigue el flujo existente sin lógica nueva de extracción — "continuar por el mismo flujo confiable" se logra por reutilización, no por duplicación. Un fallo de transcripción dispara un mensaje de reintento y conserva la grabación (el audio vive en el navegador hasta que el usuario la descarta); no deja el servicio inutilizable para el siguiente intento (probado). El idioma es una config de carga del modelo Whisper (no por-llamada), así que cambiar de idioma entre grabaciones recarga el modelo en el worker.

Tras probar el dictado con voz real (no las muestras TTS sintéticas), la calidad de transcripción no era suficiente. Dos ajustes en la misma sesión: (1) `src/voice-worker.js` solo pasaba `language` a Whisper, sin afinar decodificación — se agregaron `strategy: 'greedy'`, `temperature: 0`, `suppress_blank`/`suppress_nst`, `entropy_thold`/`logprob_thold` (valores recomendados por el propio ejemplo del SDK); (2) se subió el modelo de Whisper "base" (82 MB) a "small" (264 MB, `scripts/prepare-voice-model.js`), que en las muestras de prueba produjo texto más coherente ("ocho años" en vez de "8", "Demomed"/"Ecodemo" más cercanos a los nombres reales que la versión con guion suelto de "base"). Si la precisión sigue sin ser suficiente con voz real, el siguiente paso sería `WHISPER_LARGE_V3_TURBO` (~1.6 GB).

Modelo de voz preparado (Whisper small Q8_0, multilingüe, ~264 MB):

```text
C:\Users\kenet\.qvac\models\8a583e4a84f1fe91_ggml-small-q8_0.bin
```

Configúralo con `SITESIGNAL_VOICE_MODEL` (además de `SITESIGNAL_MODEL`) antes de `npm start` para que el dictado funcione; sin esa variable el dictado queda deshabilitado (`/api/status` reporta `voice: unavailable`) pero la captura escrita sigue intacta.

Las muestras de audio sintéticas bundleadas (`test/fixtures/voice-sample-es.wav`, `voice-sample-en.wav`) se generaron localmente con la TTS de QVAC (Supertonic multilingüe, `scripts/generate-voice-samples.js`) — mismo enfoque "sin nube, todo sintético" que el resto del dataset. `npm run qvac:check:voice` las transcribe con QVAC real como prueba de humo separada de la suite rápida (que usa un `transcribeAudio` determinista inyectado, igual que `extractText`).

El ticket #13 agrega evidencia fotográfica local: cada tarjeta de equipo en el formulario de revisión (`public/capture.js`, sección desplegable "Adjuntar evidencia fotográfica") permite subir una foto de una placa/etiqueta ficticia. El navegador la envía a `POST /api/evidence` (`public/evidence.js`), que la procesa con OCR local de QVAC (`src/plate-runtime.js`, mismo patrón de proceso hijo/IPC que `text-runtime.js` y `voice-runtime.js`, modelo `OCR_LATIN` con `detectorModelSrc: OCR_CRAFT` — QVAC exige un detector explícito para cargar el reconocedor desde una ruta local, aunque el detector en sí se resuelve por su constante de registro y no por ruta). `src/plate-extraction.js` interpreta el texto detectado de forma determinista (sin LLM): busca secuencias de etiqueta conocidas ("modelo", "número de serie", "fabricante", "fecha de fabricación", etc., en español e inglés) y solo devuelve como campo el bloque de OCR que sigue a una etiqueta reconocida; un fabricante sin etiqueta se acepta solo si es el único texto antes de la primera etiqueta (top de la placa) y un año sin etiqueta solo si es el único candidato de 4 dígitos en toda la placa — la ambigüedad nunca se resuelve por adivinanza. La imagen y sus campos se guardan localmente (`src/evidence.js`) y se enlazan a la observación vía `evidenceIds`; los campos con respaldo fotográfico llegan a estado `Confirmado` de forma directa (evidencia visual), sin requerir la corroboración cruzada de dos perfiles que usa el resto del sistema — cambiar o borrar el valor revisado nunca reescribe la evidencia original almacenada.

Modelo de evidencia preparado (EasyOCR — reconocedor `latin_g2` + detector `craft_mlt_25k`, ~15 MB + ~83 MB):

```text
C:\Users\kenet\.qvac\models\1bd09b23f28caa7e_latin_g2.gguf
```

Configúralo con `SITESIGNAL_PLATE_MODEL` (además de `SITESIGNAL_MODEL` y `SITESIGNAL_VOICE_MODEL`); sin esa variable la evidencia fotográfica queda deshabilitada (`/api/status` reporta `plate: unavailable`) pero el resto de la captura sigue intacto. `npm run qvac:prepare:photo` descarga el modelo; `npm run qvac:check:photo` corre una prueba de humo con QVAC real sobre las dos placas ficticias bundleadas (`test/fixtures/plate-sample-es.png`, `plate-sample-en.png`) y extrajo correctamente fabricante/modelo/serie/año en ambas.

## Próximo trabajo

El siguiente ticket es **#14, exportaciones y entrega offline** (`13-offline-delivery.md`).

Para cada ticket: implementa el comportamiento completo, ejecuta `npm run typecheck`, `npm test` y `git diff --check`, revisa especificación y estándares, crea un commit local y reinicia la aplicación con QVAC para la prueba visual.

## Operación y verificación

Repositorio: `C:\Users\kenet\Desktop\philips\RetoPhilips`

Modelos preparados:

```text
C:\Users\kenet\.qvac\models\6dea07e2f9342ff3_Qwen3-4B-Q4_K_M.gguf
C:\Users\kenet\.qvac\models\8a583e4a84f1fe91_ggml-small-q8_0.bin
C:\Users\kenet\.qvac\models\1bd09b23f28caa7e_latin_g2.gguf
```

Arranque en PowerShell:

```powershell
$env:SITESIGNAL_MODEL = 'C:\Users\kenet\.qvac\models\6dea07e2f9342ff3_Qwen3-4B-Q4_K_M.gguf'
$env:SITESIGNAL_VOICE_MODEL = 'C:\Users\kenet\.qvac\models\8a583e4a84f1fe91_ggml-small-q8_0.bin'
$env:SITESIGNAL_PLATE_MODEL = 'C:\Users\kenet\.qvac\models\1bd09b23f28caa7e_latin_g2.gguf'
npm start
```

La aplicación escucha en `http://127.0.0.1:3210`. Si el puerto está ocupado, comprueba primero si ya existe una instancia válida antes de detener el proceso. La base persistente está en `data/sitesignal.db`; consérvala. Las pruebas usan directorios temporales y no deben modificarla.

Estado verificado al escribir este documento:

- `npm test`: 73/73 pruebas aprobadas (incluye `test/photo-evidence.test.js`, 6 nuevas).
- `npm run qvac:check:voice`: transcribió las dos muestras sintéticas con QVAC real (Whisper small Q8_0) correctamente, en español e inglés.
- `npm run qvac:check:photo`: extrajo correctamente fabricante, modelo, número de serie y año de las dos placas ficticias bundleadas con QVAC real (EasyOCR local).
- Verificación visual en navegador: la sección "Adjuntar evidencia fotográfica" se despliega en cada tarjeta de equipo del formulario de revisión, sube el archivo a `/api/evidence` y muestra el mensaje de error esperado cuando la imagen no es válida (probado intencionalmente con un archivo corrupto).
- Validación manual con QVAC real sobre 50 relatos naturales (25 español, 25 inglés, sin datos "DemoCare" prearmados) confirmó hospital + al menos una modalidad en 50/50, ciudad en 47/50 y país en 41/50, estable en tres corridas independientes. Los huecos restantes son casos donde el propio relato no menciona ciudad/país o QVAC no lo recordó esa vez; el validador correctamente rechazó el único caso donde QVAC infirió un país ("Brazil" a partir de "São Paulo") sin que apareciera en el texto.
- `npm run typecheck`: aprobado.
- `git diff --check`: aprobado.
- Rama `main`: verifica con `git status -sb` antes de sincronizar; no se hace `push` automáticamente.
- La aplicación quedó ejecutándose con QVAC (texto, voz y evidencia fotográfica) cargado en el puerto 3210, pero un nuevo chat debe comprobar el proceso porque la sesión de terminal puede no persistir.
- GitHub CLI fue instalado e inició sesión en otra terminal, aunque esta terminal no lo encuentra actualmente en `PATH`. Abrir una terminal nueva puede ser necesario.

## Riesgos y límites conocidos

- QVAC 4B puede producir una extracción parcial en relatos con referencias ambiguas. Mantén el validador estricto y deja la corrección al formulario de revisión.
- El validador acepta fabricante/modelo/ciudad/país sin etiqueta explícita solo cuando el valor está cerca (≤40 caracteres) de la mención de la modalidad o del hospital; una afirmación más lejana o genuinamente ambigua en el relato (dos marcas nombradas con duda) sigue quedando sin respaldo a propósito.
- El número de serie sigue exigiendo su etiqueta explícita ("número de serie"/"S/N"); no se relajó por ser un campo de identidad usado en la detección de duplicados y conflictos.
- Las métricas visibles pueden superar 10 hospitales y 60 equipos porque incluyen la base local además del dataset precargado.
- No borres `data/sitesignal.db`, no reemplaces observaciones incompatibles por la más reciente y no marques campos como confirmados sin evidencia o coincidencia independiente.

Actualiza este archivo cuando completes un ticket, cambie el próximo paso, aparezca una limitación material o cambie el estado de sincronización con GitHub.
