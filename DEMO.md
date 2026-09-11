# Guion de demostración (5 minutos)

Todo el guion usa datos ficticios. Ejecuta `npm start` (o `Start-SiteSignal.ps1`) con `SITESIGNAL_MODEL`, `SITESIGNAL_VOICE_MODEL` y `SITESIGNAL_PLATE_MODEL` ya configurados; la preparación de modelos (`npm run qvac:prepare:*`) debe haberse hecho antes, con conexión, y no se repite durante la demo.

## 0. Apertura (30 s)

"SiteSignal convierte lo que un colaborador observa en una visita en inteligencia confiable sobre la base instalada, usando QVAC local." Abre la pantalla **Entorno** desde la navegación y muestra los tres modelos disponibles junto al hardware local.

## 1. Captura escrita y revisión (90 s)

Abre **Capturar**. Comprueba el perfil activo y, en el paso Relato, escribe (o pega):

> Visité Hospital Aurora del cliente Red Horizonte. Vi un tomógrafo DemoMed Ficticio, modelo XR-3000, número de serie FIC-000123 y ocho años.

Pulsa "Extraer con QVAC". Mientras corre, explica: "QVAC extrae los campos localmente; cada valor debe ser una cita literal del texto, nunca una invención." Muestra la tarjeta de revisión ya completada y el panel de confianza (completitud, vigencia, evidencia).

## 2. Evidencia fotográfica (60 s)

En la tarjeta del equipo, abre "Adjuntar evidencia fotográfica" y sube `test/fixtures/plate-sample-es.png` (una placa ficticia sintética). Pulsa "Analizar foto con QVAC": los mismos campos (fabricante, modelo, serie, año) aparecen extraídos por OCR local. Guarda la observación y muestra en el perfil 360 del hospital que fabricante y serie llegan a estado **Confirmado** directamente por la foto.

## 3. Dictado de voz (45 s)

En "Dictar la observación", elige español, graba una frase corta ficticia (p. ej. "Visité Hospital Aurora, vi un ecógrafo GE Voluson de cinco años"), detén la grabación y pulsa "Transcribir con QVAC". La transcripción llena el mismo cuadro de texto: "el dictado no duplica lógica, reutiliza el mismo flujo de revisión."

## 4. Panorama regional y consulta natural (60 s)

Ve a **Panorama**. Escribe: "Muéstrame hospitales de Panamá con equipos de más de siete años" y pulsa "Interpretar". Muestra los filtros visibles y el mapa real. Aclara: "QVAC solo interpreta filtros; nunca genera ni ejecuta SQL." Abre un marcador y entra al perfil 360.

## 5. Exportación y cierre (45 s)

Abre **Entorno** y usa las dos exportaciones. Cierra con: "Toda la inteligencia mostrada —texto, voz, evidencia, panorama y exportación— se procesó en esta computadora; OpenStreetMap solo aporta el fondo cartográfico opcional."

## Notas para quien presenta

- Si una extracción tarda (la primera inferencia de texto puede tomar 20–40 s en frío), aprovecha para explicar el modelo (Qwen3 4B Q4_K_M) mientras corre.
- Ten "Restablecer demo" a la mano si necesitas volver al dataset ficticio original entre ensayos.
- Todos los nombres, hospitales, personas y placas de equipo en este guion y en el dataset precargado son ficticios; no incluyas datos reales de pacientes o clientes durante la demostración.
