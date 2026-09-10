# Philips Customer Installed Base Intelligence

Vocabulario compartido para el prototipo que convierte conocimiento obtenido durante visitas a hospitales en una representación confiable de los equipos instalados.

## Language

**Colaborador de campo**:
Ingeniero de servicio, vendedor o especialista que visita un hospital y registra lo que observa durante la visita o inmediatamente después.
_Avoid_: Usuario principal, técnico

**Observación de campo**:
Relato aportado por un colaborador de campo sobre uno o más equipos vistos o conocidos durante una visita. Puede ser parcial, aproximado o incierto y no constituye por sí mismo un hecho confirmado.
_Avoid_: Registro de equipo, inventario confirmado

**Base instalada**:
Representación vigente de los equipos que se considera que existen en cada hospital, construida a partir de observaciones de campo y sus niveles de certeza.
_Avoid_: Lista de observaciones, inventario físico

**Inteligencia de base instalada**:
Conocimiento confiable y útil que resulta de organizar, contrastar y mantener actualizadas las observaciones de campo sobre la base instalada.
_Avoid_: Captura de datos

**Grupo de equipos**:
Representación provisional de varios equipos similares reportados como una cantidad conjunta. Puede dividirse en equipos individuales cuando observaciones posteriores aportan detalles suficientes para distinguirlos.
_Avoid_: Equipo individual, duplicado

**Estado de observación**:
Clasificación general de una observación como Confirmada, Reportada, Estimada o Desconocida. Los campos inciertos conservan además su propio estado aunque la observación tenga un estado general.
_Avoid_: Puntaje de confianza, veracidad

El estado general se deriva de los estados de hospital, modalidad y cantidad. Los demás campos conservan su clasificación individual.

**Revisión del colaborador**:
Confirmación realizada por el colaborador de campo sobre los datos interpretados antes de incorporarlos a la base instalada.
_Avoid_: Verificación independiente, aprobación del supervisor

**Confirmación**:
Condición alcanzada cuando un dato está respaldado por evidencia directa permitida o por una observación independiente coincidente. La revisión del colaborador confirma la interpretación, pero no confirma por sí sola el dato observado.
_Avoid_: Revisión del colaborador

Una confirmación independiente procede de una observación separada realizada por un perfil de colaborador diferente.

**Equipo individual**:
Representación de un equipo distinguible de los demás, identificado de forma fuerte por su número de serie o separado de un grupo mediante revisión humana cuando existen detalles suficientes.
_Avoid_: Grupo de equipos, observación

**Candidato a duplicado**:
Observación o grupo de equipos que podría referirse a un equipo ya representado en la base instalada. La coincidencia requiere una decisión humana antes de fusionarse.
_Avoid_: Duplicado confirmado

**Puntaje de confianza**:
Medida explicable calculada a partir de la completitud, la vigencia y las confirmaciones independientes disponibles para una observación.
_Avoid_: Estado de observación, certeza de la IA

**Información desactualizada**:
Información de la base instalada cuya última verificación ocurrió hace más de doce meses.
_Avoid_: Información incorrecta, equipo antiguo

**Oportunidad potencial de renovación**:
Señal sobre un equipo con antigüedad suficiente, confianza mínima e información reciente que podría justificar una revisión comercial. No constituye una recomendación definitiva.
_Avoid_: Venta garantizada, equipo obsoleto

**Captura asistida por foto**:
Extracción local de información visible en una placa o etiqueta ficticia de un equipo, sin fotografiar pacientes ni el entorno hospitalario.
_Avoid_: Fotografía del hospital, evidencia clínica

**Cliente**:
Organización de salud que puede operar uno o varios hospitales.
_Avoid_: Hospital, sede

**Hospital**:
Sede física perteneciente a un cliente, que puede contener un área o edificio opcional para ubicar equipos con mayor precisión.
_Avoid_: Cliente, área

**Historial de cambios**:
Registro de quién modificó un dato, cuál era su valor anterior, cuál es el nuevo valor y cuándo ocurrió el cambio.
_Avoid_: Observación correctiva

**Perfil de colaborador**:
Identidad local de un colaborador con nombre y rol de ingeniero de servicio, vendedor o especialista. Durante una captura existe un único perfil activo.
_Avoid_: Cuenta corporativa, usuario anónimo

Todos los perfiles pueden capturar, revisar y consultar información; el rol se conserva como procedencia y no concede permisos diferentes en el prototipo.

**Dato reportado**:
Dato afirmado explícitamente por un colaborador que aún no cuenta con evidencia directa ni corroboración independiente.
_Avoid_: Dato confirmado

**Dato estimado**:
Dato expresado como aproximación por el colaborador, incluyendo descripciones como “parece tener ocho años”.
_Avoid_: Dato desconocido, dato confirmado

**Dato desconocido**:
Dato que no fue suministrado y que no puede inferirse responsablemente.
_Avoid_: Dato estimado

**Conflicto pendiente**:
Coexistencia de observaciones incompatibles que la base instalada conserva hasta que evidencia o corroboración posterior permita resolverlas.
_Avoid_: Dato más reciente, promedio

Cualquier colaborador puede resolverlo si deja una explicación; la resolución permanece en el historial de cambios.

**Evidencia fotográfica**:
Imagen ficticia de una placa o etiqueta, conservada localmente y vinculada a la observación para respaldar los campos que confirma.
_Avoid_: Captura asistida por foto

**SiteSignal**:
Nombre del producto que presenta la inteligencia de base instalada y mantiene la captura separada de cualquier marca corporativa.

**Modalidad**:
Categoría clínica del equipo: resonancia magnética, tomografía computarizada, ultrasonido, monitoreo de pacientes, rayos X, sistema intervencionista u Otro.
_Avoid_: Modelo, fabricante

**Confianza baja**:
Puntaje de confianza entre 0 y 49.

**Confianza media**:
Puntaje de confianza entre 50 y 79.

**Confianza alta**:
Puntaje de confianza entre 80 y 100.

**Oportunidad potencial vigente**:
Oportunidad potencial de renovación asociada a un equipo de al menos siete años, con confianza mínima de 60, observación de menos de doce meses y sin conflicto pendiente sobre identidad o antigüedad.
_Avoid_: Oportunidad confirmada

**Perfil 360 del hospital**:
Vista del hospital que resume su base instalada y permite consultar las observaciones, evidencias e historial de cambios que sustentan cada dato.
_Avoid_: Perfil del cliente, panorama regional

**Panorama regional**:
Vista agregada de clientes, hospitales, modalidades, confianza, vigencia y oportunidades en Panamá, Brasil y Colombia.
_Avoid_: Perfil 360 del hospital

**Revisión de oportunidad**:
Decisión local que marca una oportunidad potencial como revisada o descartada y conserva una nota explicativa.
_Avoid_: Oportunidad comercial creada, contacto con el cliente

**Evidencia de ejecución local**:
Información visible sobre el modelo QVAC, dispositivo, conectividad y tiempo de inferencia, respaldada por los registros técnicos de la ejecución.
_Avoid_: Indicador decorativo

**Dataset sintético**:
Conjunto ficticio de aproximadamente diez hospitales y sesenta equipos distribuidos entre Panamá, Brasil y Colombia.
_Avoid_: Datos reales de clientes, información competitiva

**Consulta natural**:
Pregunta en español o inglés que se traduce en filtros permitidos sobre el panorama regional y produce una explicación breve de los resultados.
_Avoid_: Consulta SQL libre

**Equipo consolidado**:
Equipo individual que reúne varias observaciones consideradas equivalentes mediante revisión humana, conservando todas sus fuentes y evidencias originales.
_Avoid_: Observación eliminada, candidato a duplicado
