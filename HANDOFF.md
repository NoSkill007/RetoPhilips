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

El panorama incluye un dataset reiniciable de 10 hospitales y 60 equipos ficticios en Panamá, Brasil y Colombia. Sus filtros, mapa SVG local, métricas y agregaciones también incorporan las capturas locales sin permitir que “Restablecer demo” las borre. Los perfiles 360 ficticios son navegables desde la lista regional.

El ticket #10 permite escribir preguntas en español o inglés y convertirlas mediante QVAC en filtros visibles y editables de país, ciudad, cliente, hospital, modalidad, antigüedad, estado, confianza y vigencia. La API valida un contrato estricto, vuelve a comprobar que cada filtro aparezca en la pregunta y consulta únicamente el panorama local; nunca acepta SQL generado. Las intenciones ambiguas o no compatibles no aplican filtros. La consulta real `Show Brazilian customers with MR systems older than seven years` produjo los filtros de Brasil y resonancia magnética; el límite estricto “más de 7” se normaliza de forma determinista como antigüedad mínima de 8 años.

El commit `07393d4` corrige un fallo observado con QVAC real: el modelo devolvía ausencias como `"null"`/`"no specified"` y mezclaba afirmaciones válidas con otras sin respaldo. SiteSignal ahora normaliza esos marcadores, reintenta con errores concretos y conserva una extracción parcial solo cuando queda al menos un hospital y una modalidad respaldada. Los valores dudosos permanecen vacíos y visibles para revisión. La captura manual sigue siendo el último recurso cuando no queda una extracción útil.

Caso real de regresión usado:

> Estoy en Hospital DemoCare Pacific, en Ciudad de Panamá. Tienen dos resonadores magnéticos y un tomógrafo. Uno de los resonadores parece de unos ocho años, marca Siemens, pero el otro no alcancé a ver el modelo.

Con QVAC real, el resultado seguro conserva `DemoCare Pacific` y `Tomografía computarizada`; la descripción ambigua de los resonadores queda para revisión y no se convierte en cantidades inventadas. Una primera inferencia puede tardar alrededor de 30–40 segundos en este caso; las siguientes suelen ser más rápidas.

## Próximo trabajo

El siguiente ticket es **#11, oportunidades potenciales explicables**, definido en `.scratch/sitesignal/issues/10-opportunities.md`.

Después siguen, en orden:

1. `11-voice-capture.md` → ticket #12, dictado y transcripción local.
2. `12-photo-evidence.md` → ticket #13, evidencia ficticia por fotografía.
3. `13-offline-delivery.md` → ticket #14, exportaciones y entrega offline.

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

- `npm test`: 39/39 pruebas aprobadas.
- `npm run typecheck`: aprobado.
- `git diff --check`: aprobado.
- Rama `main`: verifica con `git status -sb` antes de sincronizar; no se hace `push` automáticamente.
- La aplicación quedó ejecutándose con QVAC cargado en el puerto 3210, pero un nuevo chat debe comprobar el proceso porque la sesión de terminal puede no persistir.
- GitHub CLI fue instalado e inició sesión en otra terminal, aunque esta terminal no lo encuentra actualmente en `PATH`. Abrir una terminal nueva puede ser necesario.

## Riesgos y límites conocidos

- QVAC 4B puede producir una extracción parcial en relatos con referencias ambiguas. Mantén el validador estricto y deja la corrección al formulario de revisión.
- La ciudad y el país no forman parte todavía de la captura escrita. Las observaciones locales aparecen como ubicación no informada en el panorama; el área se conserva por separado.
- Las métricas visibles pueden superar 10 hospitales y 60 equipos porque incluyen la base local además del dataset precargado.
- No borres `data/sitesignal.db`, no reemplaces observaciones incompatibles por la más reciente y no marques campos como confirmados sin evidencia o coincidencia independiente.

Actualiza este archivo cuando completes un ticket, cambie el próximo paso, aparezca una limitación material o cambie el estado de sincronización con GitHub.
