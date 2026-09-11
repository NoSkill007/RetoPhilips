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
| #11 | Oportunidades potenciales explicables | pendiente de commit |

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

## Próximo trabajo

El siguiente ticket es **#12, dictado y transcripción local** (`11-voice-capture.md`).

Después siguen, en orden:

1. `12-photo-evidence.md` → ticket #13, evidencia ficticia por fotografía.
2. `13-offline-delivery.md` → ticket #14, exportaciones y entrega offline.

Para cada ticket: implementa el comportamiento completo, ejecuta `npm run typecheck`, `npm test` y `git diff --check`, revisa especificación y estándares, crea un commit local y reinicia la aplicación con QVAC para la prueba visual.

## Operación y verificación

Repositorio: `C:\Users\kenet\Desktop\philips\RetoPhilips`

Modelo preparado:

```text
C:\Users\kenet\.qvac\models\6dea07e2f9342ff3_Qwen3-4B-Q4_K_M.gguf
```

Arranque en PowerShell:

```powershell
$env:SITESIGNAL_MODEL = 'C:\Users\kenet\.qvac\models\6dea07e2f9342ff3_Qwen3-4B-Q4_K_M.gguf'
npm start
```

La aplicación escucha en `http://127.0.0.1:3210`. Si el puerto está ocupado, comprueba primero si ya existe una instancia válida antes de detener el proceso. La base persistente está en `data/sitesignal.db`; consérvala. Las pruebas usan directorios temporales y no deben modificarla.

Estado verificado al escribir este documento:

- `npm test`: 61/61 pruebas aprobadas.
- Validación manual con QVAC real sobre 50 relatos naturales (25 español, 25 inglés, sin datos "DemoCare" prearmados) confirmó hospital + al menos una modalidad en 50/50, ciudad en 47/50 y país en 41/50, estable en tres corridas independientes. Los huecos restantes son casos donde el propio relato no menciona ciudad/país o QVAC no lo recordó esa vez; el validador correctamente rechazó el único caso donde QVAC infirió un país ("Brazil" a partir de "São Paulo") sin que apareciera en el texto.
- `npm run typecheck`: aprobado.
- `git diff --check`: aprobado.
- Rama `main`: verifica con `git status -sb` antes de sincronizar; no se hace `push` automáticamente.
- La aplicación quedó ejecutándose con QVAC cargado en el puerto 3210, pero un nuevo chat debe comprobar el proceso porque la sesión de terminal puede no persistir.
- GitHub CLI fue instalado e inició sesión en otra terminal, aunque esta terminal no lo encuentra actualmente en `PATH`. Abrir una terminal nueva puede ser necesario.

## Riesgos y límites conocidos

- QVAC 4B puede producir una extracción parcial en relatos con referencias ambiguas. Mantén el validador estricto y deja la corrección al formulario de revisión.
- El validador acepta fabricante/modelo/ciudad/país sin etiqueta explícita solo cuando el valor está cerca (≤40 caracteres) de la mención de la modalidad o del hospital; una afirmación más lejana o genuinamente ambigua en el relato (dos marcas nombradas con duda) sigue quedando sin respaldo a propósito.
- El número de serie sigue exigiendo su etiqueta explícita ("número de serie"/"S/N"); no se relajó por ser un campo de identidad usado en la detección de duplicados y conflictos.
- Las métricas visibles pueden superar 10 hospitales y 60 equipos porque incluyen la base local además del dataset precargado.
- No borres `data/sitesignal.db`, no reemplaces observaciones incompatibles por la más reciente y no marques campos como confirmados sin evidencia o coincidencia independiente.

Actualiza este archivo cuando completes un ticket, cambie el próximo paso, aparezca una limitación material o cambie el estado de sincronización con GitHub.
