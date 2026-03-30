# Lecciones Aprendidas

Archivo vivo. Se actualiza cada vez que se comete un error o se descubre un patrón que no hay que repetir. Claude DEBE leer este archivo antes de cada tarea y no repetir estos errores.

---

### #1 — No guardar texto libre médico
**Error:** Se creó una tabla `medical_notes` con campo `content: Text` donde el médico podía escribir lo que quisiera, mientras la sección de seguridad prometía "sin historia clínica".
**Lección:** Texto libre de un médico = historia clínica de facto, sin importar cómo nombres la tabla. Si la spec dice "sin datos clínicos", no puede haber campos de texto libre para médicos. Solo acciones discretas (marcar control realizado = una fecha).

### #2 — No usar JSON[] para datos que vas a consultar
**Error:** Se diseñó `conversations.messages` como un JSON[] dentro de una columna.
**Lección:** Si vas a buscar, filtrar, paginar, o mostrar esos datos en un panel, tienen que ser rows individuales en su propia tabla con índices. JSON[] solo para datos que nunca se consultan individualmente.

### #3 — No usar arrays de UUIDs para relaciones
**Error:** Se puso `programIds: UUID[]` en la tabla doctors en vez de una tabla intermedia.
**Lección:** Siempre tabla intermedia para many-to-many (doctor_programs, patient_programs). Es más consultable, permite metadata (assignedAt), y es el patrón estándar de PostgreSQL.

### #4 — No inventar datos del cliente
**Error:** Se agregó "Retiro de Medicación" como programa #10, pero no es un programa oficial del IPS.
**Lección:** Si el sistema es para un cliente específico, usar SOLO datos reales verificables. Si querés sugerir algo nuevo, separarlo claramente como "propuesta adicional", no mezclarlo con los datos oficiales.

### #5 — No agregar infra que no necesitás
**Error:** Se incluyó Redis + BullMQ en el diseño inicial para un piloto de cientos de pacientes.
**Lección:** Para un piloto, node-cron alcanza. No agregar infra (Redis, colas, service mesh) hasta que el volumen real lo justifique. Menos piezas = menos cosas que se rompen.

### #6 — UPSERT por clave única en todas las vías de entrada
**Error:** Se diseñaron 3 vías de entrada de pacientes (panel, CSV, bot) sin definir qué pasa con duplicados.
**Lección:** Cuando hay múltiples vías de entrada para la misma entidad, definir desde el diseño cuál es la clave de deduplicación (DNI) y que TODAS las vías hagan UPSERT. No asumir que "no va a pasar".

### #7 — Revisar coherencia entre secciones del documento
**Error:** Se eliminó la tabla medical_notes pero quedaron referencias a "notas médicas" en la caja de arquitectura y en el flujo del bot.
**Lección:** Cuando se elimina algo del diseño, hacer grep de ese término en TODO el documento y limpiar todas las referencias. Un documento con contradicciones internas genera bugs.

### #8 — Verificar tokens antes de asumir que funcionan
**Error:** Se actualizó el token de WhatsApp en la DB pero el viejo seguía cacheado en memoria del worker. Se perdió tiempo debuggeando.
**Lección:** Cuando actualizás credenciales en una DB y hay un cache en memoria, el cache no se invalida solo. Hay que reiniciar el proceso o implementar invalidación explícita.

### #9 — Usar TODAS las herramientas del prompt
**Error:** El usuario pasó un prompt con herramientas específicas (agents, MCPs, skills) y no se usaron todas.
**Lección:** Si el prompt lista herramientas, usarlas TODAS. Cada herramienta está ahí por una razón. Está en CLAUDE.md como REGLA #1.
