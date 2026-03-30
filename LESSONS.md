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

### #10 — No usar la misma key dos veces en un spread de Prisma where
**Error:** En `listPatients`, se construyó el filtro con dos spreads que usaban la misma key `programId`: uno con `{ in: doctorProgramIds }` y otro con `{ programId }`. El segundo sobreescribía al primero, permitiendo que un DOCTOR viera pacientes de cualquier programa.
**Lección:** En JavaScript, cuando dos spreads tienen la misma key, el último gana silenciosamente. Nunca construir filtros de Prisma con keys que puedan colisionar. Resolver la lógica ANTES del objeto (ej: calcular `effectiveProgramIds` primero) y usar una sola key en el where.

### #11 — Usar UTC explícito para fechas que se almacenan como Date (sin hora)
**Error:** En `markControl` y `enrollPatient`, se usaba `new Date()` con `setHours(0,0,0,0)` que opera en hora local del servidor. Si Railway corre en UTC y Argentina es UTC-3, a las 22:00 AR (01:00 UTC+1 del día siguiente) la fecha guardada sería mañana, no hoy.
**Lección:** Cuando se almacena un campo `@db.Date` en Prisma (solo fecha, sin hora), construir la fecha con `Date.UTC()` y usar `setUTCDate()` para aritmética. Nunca confiar en `setHours(0,0,0,0)` que depende del timezone del proceso.

### #12 — No contar como "actualizado" lo que no cambió
**Error:** En `importPatientsFromCsv`, se incrementaba `updatedCount++` para cada paciente existente encontrado, incluso si no se modificó ningún campo (todos ya tenían datos). El reporte decía "50 actualizados" cuando en realidad 0 rows cambiaron.
**Lección:** Antes de llamar a `update`, verificar que hay campos realmente diferentes. Si el objeto de updates está vacío, no ejecutar el update y no contarlo. Reportes precisos previenen confusión del operador.

### #13 — Siempre poner límite en queries que retornan listas
**Error:** `getProgramById` retornaba TODOS los `patientPrograms` de un programa sin `take`. Con 10,000 pacientes inscriptos, el endpoint devolvería toda la tabla de una.
**Lección:** Toda query con `findMany` o `include` de una relación one-to-many debe tener `take: N` o paginación explícita. Sin límite, un endpoint que funciona en dev explota en producción cuando los datos crecen.

### #14 — No sobreescribir errores de la misma fila en reportes de validación
**Error:** En `importPatientsFromCsv`, si una fila del CSV tenía DNI duplicado Y teléfono duplicado, se pusheaban dos entradas a `rowErrors` con el mismo `row`. Al construir `errorDetails[fila_N]`, el segundo error sobreescribía al primero. El admin solo veía un error, arreglaba, re-importaba, y recién ahí veía el segundo.
**Lección:** Cuando se construye un mapa de errores por key (ej: `fila_5`), siempre mergear con los existentes (`push(...re.errors)`) en vez de asignar directamente. Un error perdido = una ronda extra de debugging para el usuario.

### #15 — Recalcular fechas derivadas al cambiar estado
**Error:** `updatePatientProgramStatus` permitía reactivar un patient-program (PAUSED→ACTIVE) sin recalcular `nextReminderDate`. La fecha quedaba en el pasado, y el cron de recordatorios disparaba un reminder inmediatamente.
**Lección:** Cuando un cambio de estado afecta campos derivados (como `nextReminderDate` derivado de `lastControlDate + frecuencia`), recalcularlos en la misma operación. No confiar en que los datos calculados previamente siguen siendo válidos después de un cambio de estado.
