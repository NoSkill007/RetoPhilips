## Problem Statement

Los colaboradores de campo de una organización de tecnología médica visitan hospitales y conocen detalles valiosos sobre su base instalada, pero esa información suele permanecer en conversaciones, notas o memoria. El registro manual consume tiempo, las descripciones son inconsistentes, varias personas pueden reportar el mismo equipo y muchos datos son parciales o aproximados. Como resultado, la organización carece de una vista viva, trazable y confiable de los equipos instalados por hospital y región.

El prototipo debe demostrar que este conocimiento puede capturarse durante o inmediatamente después de una visita en menos de treinta segundos, incluso sin conectividad. La información del cliente y la inferencia no pueden salir del dispositivo. La demostración utilizará exclusivamente datos, personas, organizaciones, equipos, placas y ubicaciones ficticias.

## Solution

Construir SiteSignal, una aplicación web local adaptable a móvil para ingenieros de servicio, vendedores y especialistas. Un colaborador de campo podrá dictar o escribir una observación de campo y adjuntar una fotografía ficticia de una placa. QVAC ejecutará localmente la transcripción, extracción textual y lectura visual. SiteSignal transformará la entrada en datos estructurados, validará que cada dato esté respaldado por la entrada, formulará hasta tres preguntas útiles, presentará tarjetas editables y solicitará revisión antes de guardar.

SiteSignal conservará por separado las observaciones de campo y la base instalada. Permitirá representar grupos de equipos cuando todavía no sea posible distinguir unidades, identificar candidatos a duplicado, consolidar equipos con decisión humana, preservar conflictos pendientes y mantener un historial de cambios. Cada campo expresará su grado de certeza y cada observación tendrá un puntaje de confianza explicable.

La información resultante se mostrará en un perfil 360 del hospital y en un panorama regional de Panamá, Brasil y Colombia. Los usuarios podrán consultar los datos mediante lenguaje natural, revisar información desactualizada y gestionar oportunidades potenciales de renovación. La aplicación persistirá localmente, exportará datos estructurados y mostrará evidencia verificable de que QVAC ejecuta la inferencia en el dispositivo.

## User Stories

1. Como colaborador de campo, quiero crear un perfil local con mi nombre y rol, para que mis observaciones tengan procedencia.
2. Como colaborador de campo, quiero elegir el perfil activo antes de registrar una visita, para atribuir correctamente la observación.
3. Como ingeniero de servicio, quiero registrar una observación durante una visita, para no depender de mi memoria posterior.
4. Como colaborador de campo, quiero registrar una observación inmediatamente después de una visita, para evitar utilizar el dispositivo frente al cliente.
5. Como colaborador de campo, quiero escribir una observación en lenguaje natural, para evitar formularios extensos.
6. Como colaborador de campo, quiero dictar una observación en español o inglés, para capturarla rápidamente.
7. Como colaborador de campo, quiero seleccionar el idioma antes de dictar, para obtener una transcripción más predecible.
8. Como colaborador de campo, quiero adjuntar una fotografía ficticia de una placa o etiqueta, para complementar mi relato con evidencia directa.
9. Como colaborador de campo, quiero combinar texto o voz con una fotografía opcional, para registrar toda la información disponible en un único flujo.
10. Como colaborador de campo, quiero que SiteSignal identifique el cliente, hospital y área opcional, para ubicar correctamente los equipos.
11. Como colaborador de campo, quiero que SiteSignal sugiera hospitales existentes por similitud de nombre, para no crear sedes duplicadas.
12. Como colaborador de campo, quiero crear un hospital cuando no exista, para registrar una visita a una sede nueva.
13. Como colaborador de campo, quiero que QVAC extraiga modalidad, cantidad, fabricante, modelo, número de serie y antigüedad cuando aparezcan, para convertir mi relato en datos estructurados.
14. Como colaborador de campo, quiero que los campos ausentes permanezcan desconocidos, para que SiteSignal no invente información.
15. Como colaborador de campo, quiero que expresiones aproximadas produzcan datos estimados, para conservar la incertidumbre original.
16. Como colaborador de campo, quiero recibir hasta tres preguntas, una por vez y con opción de responder que no sé, para completar los datos más valiosos sin alargar la captura.
17. Como colaborador de campo, quiero que las preguntas prioricen hospital, modalidad, cantidad, fabricante, modelo y antigüedad, para completar primero la información esencial.
18. Como colaborador de campo, quiero revisar tarjetas editables por equipo antes de guardar, para corregir cualquier interpretación errónea.
19. Como colaborador de campo, quiero ver el estado de cada campo incierto, para entender qué es conocido y qué es aproximado.
20. Como colaborador de campo, quiero completar una observación sencilla en menos de treinta segundos, para que el registro sea viable después de cada visita.
21. Como colaborador de campo, quiero continuar manualmente cuando QVAC falle dos veces, para no perder la observación.
22. Como usuario, quiero que una captura manual registre que la IA no intervino, para conservar la trazabilidad del proceso.
23. Como usuario, quiero que un reporte de varios equipos similares permanezca como grupo, para no inventar identidades individuales.
24. Como usuario, quiero separar un equipo identificado de un grupo y reducir la cantidad restante, para mantener el total correcto.
25. Como usuario, quiero que un número de serie idéntico detecte una coincidencia fuerte, para evitar contar dos veces el mismo equipo.
26. Como usuario, quiero recibir candidatos a duplicado basados en hospital, modalidad, fabricante, modelo, cantidad y antigüedad, para revisar coincidencias sin serie.
27. Como usuario, quiero ver por qué dos registros parecen duplicados, para tomar una decisión informada.
28. Como usuario, quiero decidir si consolido un candidato a duplicado, para evitar fusiones automáticas equivocadas.
29. Como usuario, quiero que un equipo consolidado conserve todas sus observaciones y evidencias, para no perder procedencia.
30. Como usuario, quiero que observaciones incompatibles permanezcan como conflicto pendiente, para no presentar arbitrariamente una versión como cierta.
31. Como usuario, quiero resolver un conflicto con una explicación, para dejar constancia de la decisión.
32. Como usuario, quiero que cualquier perfil pueda resolver conflictos, para mantener simples los permisos del prototipo.
33. Como usuario, quiero corregir un dato conservando valor anterior, valor nuevo, autor y fecha, para auditar los cambios.
34. Como usuario, quiero que una corrección sea reportada salvo que incluya evidencia o corroboración, para no confundir edición con confirmación.
35. Como usuario, quiero que una observación independiente de otro perfil pueda corroborar un dato, para elevar su certeza.
36. Como usuario, quiero que una fotografía confirme únicamente los campos que muestra, para no extender la evidencia más allá de su alcance.
37. Como usuario, quiero consultar estados Confirmado, Reportado, Estimado y Desconocido, para comprender la calidad de cada dato.
38. Como usuario, quiero que el estado general refleje el estado más débil entre hospital, modalidad y cantidad, para conocer el límite de confiabilidad de la observación.
39. Como usuario, quiero ver un puntaje de confianza de 0 a 100, para comparar la calidad de las observaciones.
40. Como usuario, quiero ver cómo completitud, vigencia y corroboración forman el puntaje, para entenderlo y reproducirlo.
41. Como usuario, quiero identificar información no verificada durante más de doce meses, para priorizar nuevas visitas.
42. Como usuario, quiero abrir el perfil 360 de un hospital, para conocer su base instalada vigente.
43. Como usuario, quiero navegar desde un equipo consolidado hasta sus observaciones, fotografías y cambios, para auditar su procedencia.
44. Como usuario, quiero filtrar la base instalada por cliente, hospital, país, ciudad y modalidad, para encontrar información relevante.
45. Como usuario, quiero explorar un mapa vectorial local de Panamá, Brasil y Colombia, para analizar la base instalada sin depender de mapas en línea.
46. Como usuario, quiero ver agregados por modalidad, geografía, antigüedad, confianza y vigencia, para comprender el panorama regional.
47. Como usuario, quiero formular consultas naturales en español o inglés, para explorar los datos sin aprender filtros complejos.
48. Como usuario, quiero que una consulta natural active filtros permitidos y explique el resultado, para verificar cómo fue interpretada.
49. Como vendedor, quiero ver oportunidades potenciales vigentes, para identificar hospitales que podrían requerir revisión comercial.
50. Como vendedor, quiero conocer edad, confianza, vigencia y ausencia de conflicto que originaron una oportunidad, para valorar la señal.
51. Como usuario, quiero marcar una oportunidad como revisada o descartada con una nota, para gestionar su seguimiento local.
52. Como usuario, quiero exportar la base instalada a CSV, para revisarla mediante otras herramientas.
53. Como usuario, quiero exportar observaciones e historial a JSON, para verificar que el repositorio es estructurado.
54. Como usuario, quiero conservar datos, fotografías e historial después de reiniciar SiteSignal, para mantener una base instalada viva.
55. Como jurado, quiero ver el modelo QVAC, dispositivo, conectividad y tiempo de inferencia, para comprobar que la IA funciona localmente.
56. Como jurado técnico, quiero contrastar el panel local con registros de QVAC, para verificar que el indicador no es decorativo.
57. Como evaluador, quiero ejecutar SiteSignal mediante un script de Windows que comprueba requisitos, inicia el servicio y abre la interfaz, para reproducir la demostración con pocos pasos.
58. Como evaluador, quiero ejecutar captura, extracción, almacenamiento y consulta sin red, para verificar el requisito técnico del hackathon.
59. Como evaluador, quiero cargar un dataset sintético de aproximadamente diez hospitales y sesenta equipos, para explorar varias situaciones sin acceder a información confidencial.
60. Como usuario, quiero reconocer resonancia magnética, tomografía computarizada, ultrasonido, monitoreo de pacientes, rayos X, sistemas intervencionistas y Otro, para cubrir las modalidades principales sin rechazar casos desconocidos.

## Implementation Decisions

- SiteSignal se ejecutará principalmente en una computadora Windows mediante `localhost` y tendrá una interfaz web adaptable a dimensiones móviles.
- La solución se dividirá en una interfaz web, un servicio local Node.js y persistencia SQLite con una carpeta local para evidencias.
- La inferencia de texto, voz y visión se realizará exclusivamente mediante QVAC en el dispositivo. No se utilizará ninguna API de inferencia en la nube.
- La interfaz podrá estudiarse posteriormente para acceso desde la red local o alojamiento estático público, pero el flujo aceptado para el hackathon y las pruebas será local.
- Se evaluará Qwen 3 de 4B cuantizado como modelo textual principal. Si no satisface el objetivo de treinta segundos, se evaluará un modelo de 1.7B con las mismas validaciones.
- El modelo textual permanecerá cargado durante el uso normal. Los modelos de transcripción y visión se cargarán cuando sean necesarios para controlar el consumo de memoria.
- Cada salida de IA se validará mediante un esquema estricto, un catálogo de modalidades y comparación con la entrada. Los datos sin respaldo se rechazarán o quedarán desconocidos.
- Una extracción inválida se reintentará una vez. Si vuelve a fallar, se ofrecerá captura manual y se registrará que la IA no intervino.
- La captura aceptará texto o voz como entrada principal y una fotografía opcional de una placa o etiqueta ficticia.
- La transcripción admitirá español e inglés con selección explícita del idioma antes de grabar.
- La captura asistida por foto intentará extraer fabricante, modelo, número de serie y año de fabricación o instalación cuando sean visibles. Conservará el texto detectado para revisión.
- La aplicación utilizará la jerarquía Cliente, Hospital y área o edificio opcional.
- Las observaciones de campo se conservarán como fuentes inmutables de conocimiento; las correcciones se registrarán en un historial de cambios auditable.
- La base instalada será una proyección actual derivada de observaciones, consolidaciones y resoluciones de conflictos.
- Un grupo de equipos conservará una cantidad conjunta hasta que existan detalles suficientes para distinguir unidades. Separar una unidad reducirá la cantidad restante del grupo.
- El número de serie será la identidad fuerte de un equipo individual. Sin serie, la coincidencia aproximada nunca producirá una consolidación automática.
- Los candidatos a duplicado usarán coincidencias explicables de hospital, modalidad, fabricante, modelo, cantidad y antigüedad.
- Consolidar duplicados producirá un equipo consolidado que mantiene vínculos a todas las observaciones y evidencias originales.
- Las observaciones contradictorias se conservarán como conflictos pendientes. Cualquier perfil podrá resolverlos dejando una explicación y registro histórico.
- Un dato será Confirmado únicamente mediante evidencia directa permitida o una observación separada de otro perfil. La revisión de la extracción no cambia por sí sola el dato a Confirmado.
- El estado general será el estado más débil entre hospital, modalidad y cantidad. Los otros campos conservarán estados propios.
- El puntaje de confianza asignará hasta 40 puntos por completitud, 25 por vigencia y 35 por evidencia o confirmaciones independientes. Los rangos serán baja 0–49, media 50–79 y alta 80–100.
- La información se considerará desactualizada después de doce meses sin verificación.
- Una oportunidad potencial vigente requerirá antigüedad de al menos siete años, confianza mínima de 60, observación de menos de doce meses y ausencia de conflictos sobre identidad o antigüedad.
- Las consultas naturales se limitarán a intenciones y filtros permitidos sobre país, ciudad, cliente, hospital, modalidad, antigüedad, estado, confianza y vigencia. No se ejecutará SQL generado libremente.
- El mapa será un recurso vectorial local y no dependerá de proveedores cartográficos en línea.
- El dataset de demostración contendrá entidades completamente ficticias y cubrirá Panamá, Brasil y Colombia.
- La base instalada podrá exportarse a CSV; las observaciones, evidencias referenciadas e historial podrán exportarse a JSON.
- La aplicación mostrará evidencia de ejecución local: modelo QVAC, dispositivo, estado de red y duración de cada inferencia. Los registros técnicos permitirán corroborarla.
- Un script para Windows verificará requisitos, iniciará los componentes locales y abrirá SiteSignal. La descarga inicial de dependencias y modelos será un paso de preparación separado.
- El prototipo no implementará cifrado local empresarial. Documentará cifrado, control de acceso y gobierno de datos como requisitos para producción.
- La interfaz usará una estética empresarial de salud clara y sobria, sin presentarse como producto oficial ni copiar la identidad visual de Philips.
- Si el tiempo amenaza la entrega, se priorizarán el flujo mínimo de Philips y QVAC; luego confianza, duplicados y preguntas; finalmente voz, fotografía, consultas y oportunidades.

## Testing Decisions

- Las pruebas evaluarán comportamiento observable y contratos del producto; no afirmarán detalles internos ni estructuras privadas.
- El límite principal de prueba será la API local de SiteSignal. Desde allí se probará el flujo completo con reglas reales y SQLite.
- Las capacidades de texto, voz y visión usarán adaptadores deterministas en la suite rápida para evitar que respuestas generativas vuelvan inestables las pruebas.
- Las pruebas de API cubrirán extracción válida, datos ausentes, estimaciones, rechazo de datos inventados, reintento, captura manual y prioridad de preguntas.
- Las pruebas de API cubrirán grupos, separación de unidades, candidatos a duplicado, consolidación, conflictos, resoluciones y conservación de procedencia.
- Las pruebas de API cubrirán estados de campo, estado general, fórmula de confianza, envejecimiento de datos y oportunidades potenciales.
- Las pruebas de API cubrirán perfiles, clientes, hospitales, áreas, perfil 360, panorama regional, filtros y consultas naturales permitidas.
- Las pruebas de API cubrirán correcciones auditables, persistencia entre reinicios y exportaciones CSV y JSON.
- Habrá una prueba aislada con QVAC real que cargará el modelo, procesará una observación sintética sin internet y verificará el esquema de salida.
- La prueba real de QVAC no formará parte de cada corrida rápida por su costo, variabilidad y dependencia de modelos descargados.
- Una prueba manual de aceptación ejecutará captura, extracción, almacenamiento, perfil 360 y consulta con la red deshabilitada.
- La demostración medirá el tiempo desde el inicio de una observación sencilla hasta su revisión, con objetivo inferior a treinta segundos.
- No existe código de pruebas previo en el repositorio; estos límites serán el precedente inicial.

## Out of Scope

- Uso de datos reales o confidenciales de hospitales, pacientes, fabricantes o competidores.
- Inferencia mediante servicios o API en la nube.
- Diagnóstico clínico, recomendaciones médicas o procesamiento de información de pacientes.
- Integración real con Microsoft Teams, CRM, ERP u otros sistemas corporativos.
- Creación automática de oportunidades comerciales, contacto con clientes o envío de correos.
- Autenticación corporativa, permisos diferenciados por rol y administración empresarial de identidades.
- Garantías de cifrado, gestión de claves, cumplimiento regulatorio o gobierno de datos propios de producción.
- Fusión automática de candidatos a duplicado o resolución automática de conflictos.
- Aplicación móvil nativa, distribución mediante tiendas móviles o ejecución en emuladores.
- Sincronización entre dispositivos, inferencia P2P o colaboración multiusuario en tiempo real.
- Dependencia de mapas, geocodificación o recursos visuales obtenidos desde internet durante la ejecución.
- Alojamiento público como requisito para la demostración; cualquier publicación futura deberá conservar la inferencia y los datos sensibles en el entorno local.
- Escalabilidad y operación productiva sobre miles de clientes.

## Further Notes

- El repositorio y el README deberán declarar toda base preexistente, librería, plantilla, modelo, cuantización, API no relacionada con inferencia y componente de terceros utilizado.
- El README deberá documentar especificaciones de hardware, preparación inicial, descarga de modelos, inicio normal, prueba sin conexión y limitaciones conocidas.
- La demostración principal utilizará un ingeniero de servicio ficticio que dicta una observación con varios equipos y una antigüedad estimada, y adjunta una placa ficticia.
- Después de guardar, la demostración recorrerá el perfil 360 del hospital, el mapa, una consulta natural, un candidato a duplicado y una oportunidad potencial explicable.
- El video será en español, durará como máximo cinco minutos y mostrará Wi-Fi desactivado junto con el panel técnico y registros de QVAC.
- El prototipo compite por el reto corporativo de Philips y por el ranking general; la calidad de la integración real con QVAC tiene prioridad sobre capacidades visuales simuladas.
