# Guion de demostración (5 minutos)

Todo el guion usa datos ficticios. Ejecuta `npm start` (o `Start-SiteSignal.ps1`) con `SITESIGNAL_MODEL`, `SITESIGNAL_VOICE_MODEL` y `SITESIGNAL_PLATE_MODEL` ya configurados; la preparación de modelos (`npm run qvac:prepare:*`) debe haberse hecho antes, con conexión, y no se repite durante la demo.

## 0. Apertura (30 s)

"SiteSignal es un prototipo que convierte lo que un ingeniero de servicio observa en una visita en una base instalada consultable, usando inteligencia local con QVAC. No hay nube: todo el modelo corre en esta computadora." Señala la sección "Estado del entorno" al final de la página: los tres modelos (texto, voz, evidencia fotográfica) están "Disponible", con el hardware local declarado.

## 1. Captura escrita y revisión (90 s)

En "Registrar una visita", escribe (o pega):

> Visité Hospital Aurora del cliente Red Horizonte. Vi un tomógrafo DemoMed Ficticio, modelo XR-3000, número de serie FIC-000123 y ocho años.

Pulsa "Extraer con QVAC". Mientras corre, explica: "QVAC extrae los campos localmente; cada valor debe ser una cita literal del texto, nunca una invención." Muestra la tarjeta de revisión ya completada y el panel de confianza (completitud, vigencia, evidencia).

## 2. Evidencia fotográfica (60 s)

En la tarjeta del equipo, abre "Adjuntar evidencia fotográfica" y sube `test/fixtures/plate-sample-es.png` (una placa ficticia sintética). Pulsa "Analizar foto con QVAC": los mismos campos (fabricante, modelo, serie, año) aparecen extraídos por OCR local. Guarda la observación y muestra en el perfil 360 del hospital que fabricante y serie llegan a estado **Confirmado** directamente por la foto.

## 3. Dictado de voz (45 s)

En "Dictar la observación", elige español, graba una frase corta ficticia (p. ej. "Visité Hospital Aurora, vi un ecógrafo GE Voluson de cinco años"), detén la grabación y pulsa "Transcribir con QVAC". La transcripción llena el mismo cuadro de texto: "el dictado no duplica lógica, reutiliza el mismo flujo de revisión."

## 4. Panorama regional y consulta natural (60 s)

Ve a "Panorama regional". Escribe en el cuadro de pregunta: "Muéstrame hospitales de Panamá con equipos de más de siete años" y pulsa "Interpretar con QVAC". Muestra los filtros visibles resultantes y aclara: "QVAC solo interpreta filtros; nunca genera ni ejecuta SQL." Haz clic en un hospital del mapa para navegar a su perfil 360.

## 5. Exportación y cierre (45 s)

Baja a "Estado del entorno" y pulsa "Exportar base instalada (CSV)" y "Exportar observaciones y evidencia (JSON)". Abre brevemente el CSV: "esta es la base instalada capturada, lista para análisis externo." Cierra con: "Todo lo mostrado —captura, voz, evidencia, panorama y exportación— corrió sin salir de esta computadora."

## Notas para quien presenta

- Si una extracción tarda (la primera inferencia de texto puede tomar 20–40 s en frío), aprovecha para explicar el modelo (Qwen3 4B Q4_K_M) mientras corre.
- Ten "Restablecer demo" a la mano si necesitas volver al dataset ficticio original entre ensayos.
- Todos los nombres, hospitales, personas y placas de equipo en este guion y en el dataset precargado son ficticios; no incluyas datos reales de pacientes o clientes durante la demostración.
