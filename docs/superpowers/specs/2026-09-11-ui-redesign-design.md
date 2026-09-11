# Rediseño de UI/UX de SiteSignal

Fecha: 2026-09-11. Estado: aprobado por el usuario en chat.

## Objetivo

Reemplazar la interfaz actual de una sola página (cuatro secciones apiladas en `public/index.html`) por una aplicación de varias pantallas, responsive para móvil, tablet y computadora, con identidad visual nueva inspirada en Philips y un mapa real navegable. El servidor, la API y toda la lógica de datos, validación y QVAC se conservan; solo se agregan coordenadas y un servicio estático más flexible.

## Decisiones confirmadas

- Cuatro pantallas por tarea: Panorama, Capturar, Hospitales (lista y perfil 360 en ruta propia) y Entorno.
- Mapa con Leaflet y tiles de OpenStreetMap. Es la única petición de red permitida en ejecución. Los modelos QVAC (texto, voz, OCR) siguen siendo locales sin excepción; ese punto no es negociable.
- Identidad nueva: azul inspirado en Philips como primario, tipografía del sistema, modo claro y oscuro automático.
- Stack sin build: HTML, CSS y módulos ES servidos por el mismo servidor Node. Leaflet se instala con npm y se sirve desde `node_modules` en `/vendor/leaflet/*`.
- Se reescribe la capa de interfaz reutilizando las llamadas a la API y las reglas ya probadas del `capture.js` actual. El backend cambia lo mínimo.

## Arquitectura del frontend

### Cascarón y router

- `public/index.html` es el único HTML. Contiene la barra lateral (≥1024px), la barra superior compacta y la barra de pestañas inferior (<1024px), el contenedor de pantalla `<main id="screen">` y el contenedor de toasts.
- `public/router.js` resuelve rutas por hash: `#/panorama` (por defecto), `#/capturar`, `#/hospitales`, `#/hospitales/:id`, `#/entorno`. Cada pantalla exporta `mount(container, params)` y opcionalmente `unmount()`. El router llama a `unmount` de la pantalla anterior antes de montar la siguiente, y marca el enlace activo en la navegación.
- `public/lib/api.js` centraliza `fetch` a `/api/*` con manejo de errores uniforme. `public/lib/dom.js` ofrece ayudantes de creación de nodos. `public/lib/toast.js` muestra mensajes de éxito o error apilados, con `aria-live`, que reemplazan al `#feedback` pegajoso actual.
- `public/screens/panorama.js`, `capture.js`, `hospital.js`, `environment.js` contienen cada pantalla. `public/voice.js` y `public/evidence.js` pasan a `public/lib/voice.js` y `public/lib/evidence.js` como piezas que la pantalla Capturar monta cuando entra al paso correspondiente; su lógica interna (grabación, reencodificación WAV, subida de evidencia) no cambia.
- Estado compartido mínimo en `public/lib/state.js`: perfil activo (persistido en `localStorage`), borrador de captura en memoria (se pierde al recargar, igual que hoy), último estado de `/api/status` con emisión de eventos para que las pantallas reaccionen.

### Estilos

- `public/styles/tokens.css`: variables de color, tipografía, espaciado, radios y sombras, con bloque `@media (prefers-color-scheme: dark)`.
- `public/styles/layout.css`: cascarón, navegación, rejillas responsive, puntos de corte (móvil <768px, tablet 768–1023px, escritorio ≥1024px).
- `public/styles/components.css`: botones, campos, tarjetas, chips, pestañas, stepper, toasts, badges de estado y confianza, tablas responsive.
- `public/styles/screens.css`: ajustes específicos de cada pantalla.
- Sin fuentes ni CSS externos. Objetivos táctiles de al menos 44px. Foco visible en todos los controles.

### Identidad visual

- Primario azul (`#0B5FD1` aproximado, ajustado para contraste AA sobre blanco y sobre fondo oscuro), neutros grises fríos, superficie blanca en claro y gris azulado profundo en oscuro.
- Colores semánticos fijos por estado de dato: Confirmado verde, Reportado azul, Estimado ámbar, Desconocido gris. Bandas de confianza: Alta verde, Media ámbar, Baja rojo.
- Jerarquía: título de pantalla, subtítulo, tarjetas con más aire que hoy, secciones separadas por espacio y no por líneas.

## Pantallas

### Panorama (`#/panorama`)

1. Fila de cinco KPIs: hospitales, equipos, confianza media, información desactualizada, oportunidades potenciales. En móvil, dos columnas.
2. Barra de pregunta en lenguaje natural con botón "Interpretar con QVAC" y resultado con chips de filtros removibles, igual que hoy en comportamiento.
3. Filtros: botón "Filtros" con contador de activos que abre un panel desplegable (cajón lateral en móvil). Chips de filtros activos visibles debajo de la barra de pregunta. Botón "Limpiar".
4. Mapa y lista de hospitales lado a lado en escritorio; en móvil y tablet, pestañas "Mapa" y "Lista".
5. Gráficos de agregación (región, modalidad, geografía, antigüedad, confianza, vigencia) en rejilla de tarjetas al final.
6. El botón "Restablecer demo" se mueve a Entorno.

### Mapa

- Leaflet inicializado sobre `div#map` con tiles `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` y atribución de OpenStreetMap. Vista inicial centrada en Latinoamérica.
- Un marcador por hospital con coordenadas. El color del marcador refleja la banda de confianza media. Popup con nombre, cliente, ciudad y país, cantidad de equipos, confianza media, origen (capturado o ficticio) y botón "Ver perfil" que navega a `#/hospitales/:id`.
- Varios hospitales en la misma ciudad se separan con un desplazamiento pequeño y determinista (por índice) para que no se superpongan.
- Al aplicar filtros, el mapa hace `fitBounds` a los marcadores visibles; si no hay ninguno, vuelve a la vista inicial.
- Lista de países con conteos (reemplaza la leyenda del SVG): al pulsar un país se aplica el filtro de país.
- Sin conexión: Leaflet dispara `tileerror`; al primer error se muestra un aviso discreto dentro del mapa ("Sin conexión: el mapa base no está disponible. Los marcadores siguen funcionando.") y el fondo queda neutro. Nada más cambia. El aviso desaparece si después un tile carga con éxito.
- El SVG actual y `#map-legend` desaparecen.

### Capturar (`#/capturar`)

Asistente de cuatro pasos con indicador de progreso (stepper horizontal en escritorio, compacto en móvil). Solo se puede avanzar al siguiente paso cuando el actual está completo; siempre se puede volver atrás.

1. **Perfil**: seleccionar perfil existente o crear uno (nombre y rol). El perfil elegido se guarda en `localStorage` para no repetir el paso en visitas siguientes; el paso se muestra ya completado en ese caso, con opción de cambiar.
2. **Relato**: pestañas "Escribir" y "Dictar". Escribir: textarea con contador y ejemplo. Dictar: selector de idioma, grabar, detener, escuchar, transcribir, descartar; la transcripción rellena el mismo textarea y marca `source = 'voice'`. Si `/api/status` reporta voz no disponible, la pestaña Dictar aparece deshabilitada con el motivo. Si el modelo de texto no está disponible, el botón "Extraer con QVAC" se deshabilita con el motivo y se ofrece "Captura manual" (misma función que hoy). Editar el texto tras extraer invalida el borrador, como hoy.
3. **Revisar**: aviso de validación, pregunta de seguimiento, destino de la observación (con la advertencia de coincidencia y el manejo del 409 existente), panel de relación con grupo existente, campos de ubicación, tarjetas de equipo (con la sección de evidencia fotográfica, deshabilitada con motivo si OCR no está disponible), botón "Añadir tarjeta", comentarios y evaluación de confianza. En móvil las tarjetas de equipo ocupan todo el ancho.
4. **Guardado**: confirmación con resumen (hospital, equipos, confianza), botón "Ver perfil del hospital" y botón "Nueva observación" que vuelve al paso 2 con el mismo perfil.

### Hospitales (`#/hospitales` y `#/hospitales/:id`)

- Lista: buscador por nombre, cliente o ciudad; filtro Todos / Capturados / Ficticios; tarjetas con nombre, cliente, ubicación, equipos, confianza media, contador de pendientes (duplicados más conflictos) y oportunidades vigentes.
- Detalle: cabecera con nombre, cliente, ubicación, región, origen y botón "Nueva observación aquí" (va a Capturar con el hospital preseleccionado como destino). Pestañas:
  - **Base instalada**: tarjetas de equipo con estados por campo, formulario "Corregir un dato" y evidencia enlazada.
  - **Observaciones**: cada observación con texto original, procedencia, canal, comentarios y evaluación.
  - **Pendientes**: candidatos a duplicado (comparación lado a lado, en una columna en móvil) y conflictos, con sus acciones actuales. La pestaña muestra un contador.
  - **Oportunidades**: señales con condiciones, acciones "Marcar revisada" y "Descartar" con nota.
  - **Historial**: historial de cambios y de conflictos resueltos.
- Toda la lógica de estas acciones se traslada desde `capture.js` sin cambiar sus llamadas ni sus mensajes.

### Entorno (`#/entorno`)

- Resumen del entorno y hardware.
- Cinco tarjetas de estado (aplicación, almacenamiento, texto, voz, evidencia fotográfica) con diagnósticos.
- Exportaciones CSV y JSON.
- "Restablecer demo" con diálogo de confirmación nativo; el texto aclara que las capturas locales no se borran.
- Id de instalación y número de arranques.
- Actualización automática cada 5 s mientras la pantalla está montada; se detiene al desmontar.

## Backend

### Servicio estático

- `src/application.js` deja de usar el mapa fijo de siete archivos. Sirve cualquier archivo bajo `public/` resolviendo la ruta contra ese directorio y rechazando con 404 cualquier ruta cuyo resultado quede fuera de `public/` (incluye `..` codificado). `/` sirve `index.html`. Tipos MIME por extensión: html, css, js, json, png, svg, webp, ico.
- `/vendor/leaflet/*` se sirve desde `node_modules/leaflet/dist/` con la misma protección de ruta. Solo se exponen `leaflet.js`, `leaflet.css` e `images/*`.
- CSP nueva: `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org; frame-ancestors 'none'`.
- `leaflet` pasa a `dependencies` en `package.json`.

### Coordenadas

- `src/geo.js` nuevo: tabla local de ciudades latinoamericanas (al menos las doce del dataset ficticio más las capitales y ciudades grandes de Panamá, Brasil, Colombia, México, Chile, Argentina, Perú, Ecuador, Bolivia, Uruguay, Paraguay, Venezuela, Costa Rica, Guatemala y República Dominicana) y centroides por país. Exporta `coordinatesFor(city, country)` que devuelve `{lat, lng, precision: 'city'}` si la ciudad normalizada (sin acentos, minúsculas) está en la tabla y el país coincide, `{lat, lng, precision: 'country'}` si solo se reconoce el país, y `null` en cualquier otro caso. Nunca consulta la red.
- `src/regional-panorama.js` agrega `coordinates` a cada hospital de `hospitals` en `/api/panorama` y al detalle de hospital ficticio. `src/observations.js` lo agrega al detalle de hospital capturado. El campo `map` (conteos por país) se conserva para compatibilidad pero ya incluye todos los países, no solo tres.

## Manejo de errores

- Errores de API: toast de error con el mensaje del servidor; el control que disparó la acción se rehabilita.
- Mapa sin conexión: aviso dentro del mapa, sin bloquear nada.
- Servicios QVAC no disponibles: los controles dependientes se deshabilitan con el motivo textual tomado de `/api/status`; la captura manual sigue disponible.
- Ruta desconocida: redirige a `#/panorama`. Hospital inexistente: mensaje "Hospital no encontrado" con enlace a la lista.

## Pruebas

- `test/geo.test.js` nuevo: ciudad conocida devuelve precisión de ciudad; ciudad con acentos o mayúsculas distintas coincide; ciudad desconocida con país conocido devuelve centroide de país; país desconocido devuelve `null`.
- `test/regional-panorama.test.js`: cada hospital del panorama tiene `coordinates` con precisión de ciudad; un hospital capturado con ciudad no listada cae al país; `map` incluye México y Chile.
- `test/startup.test.js`: sirve `index.html`, un archivo anidado en `styles/`, `vendor/leaflet/leaflet.js`; rechaza `/../package.json` y variantes codificadas con 404; la cabecera CSP contiene el host de tiles.
- Las 91 pruebas existentes siguen pasando. `npm run typecheck` y `git diff --check` limpios.
- Verificación visual con el navegador integrado a 375, 768 y 1280px en las cuatro pantallas y en el detalle de hospital, en modo claro y oscuro. Prueba de punta a punta con QVAC real: crear perfil, extraer, revisar, guardar, ver el hospital en el mapa y en su perfil.

## Documentación

- `README.md`: la frase "ningún archivo de `public/` hace peticiones a un host externo" cambia para declarar que el mapa base de OpenStreetMap es la única petición externa en ejecución, opcional y degradable; la sección de ejecución sin conexión documenta el aviso del mapa.
- `DEMO.md`: guion ajustado a las pantallas nuevas.
- `HANDOFF.md`: estado, verificación y estructura nueva del frontend.

## Fuera de alcance

Empaquetado como instalador, autenticación, cifrado, geocodificación en línea, coropletas por país, región como filtro de lenguaje natural, cambios de esquema de base de datos.
