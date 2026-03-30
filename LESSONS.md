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

### #16 — No mezclar expresión cron UTC con timezone explícito
**Error:** En el cron de recordatorios se usó `DEFAULT_CRON = '0 11 * * *'` (pensando en 11 UTC = 8 AM Argentina) PERO también se pasó `timezone: 'America/Argentina/Buenos_Aires'` a node-cron. Esto haría que el cron corra a las 11:00 AM hora Argentina, no a las 8:00 AM.
**Lección:** Cuando node-cron tiene `timezone` configurado, la expresión cron se interpreta EN ese timezone. Si querés 8 AM Argentina, la expresión debe ser `'0 8 * * *'` con timezone Argentina, NO `'0 11 * * *'`. Elegir UNA convención: o expresión en UTC sin timezone, o expresión en hora local con timezone explícito. Nunca mezclar.

### #17 — Definir el contrato API↔Frontend ANTES de codear ambos lados
**Error:** En Paso 8, el frontend definió interfaces TypeScript (`PatientsResponse`, `PatientDetail`, `Reminder`) asumiendo shapes que no coincidían con lo que la API devolvía. La lista de pacientes esperaba `{ total, page, limit, totalPages }` en el root pero la API devolvía `{ pagination: { page, limit, total, pages } }`. La ficha de paciente esperaba `enrolledByDoctor`, `reminderFrequencyDays`, y `conversations` que la API no incluía. Esto causaba crashes en runtime que TypeScript no detecta (los tipos del frontend son declaraciones de fe, no contratos verificados).
**Lección:** Cuando el frontend y el backend se crean en el mismo paso, PRIMERO definir el shape exacto de cada response de API (o leer el código del service layer), y DESPUÉS crear las interfaces del frontend copiando esa estructura. Nunca asumir qué devuelve un endpoint — leerlo. Alternativa: usar un tipo compartido en `packages/shared/`.

### #18 — No mostrar acciones inválidas para el estado actual
**Error:** El botón "Marcar control" se mostraba para programas en estado PAUSED. Marcar un control en un programa pausado no tiene sentido operativo y puede generar datos inconsistentes (el cron podría disparar recordatorios inesperados).
**Lección:** Las acciones disponibles en la UI deben reflejar las transiciones de estado válidas. Si un programa está PAUSED, solo se puede Reactivar. Si está ACTIVE, se puede Pausar o Marcar control. Si está COMPLETED, no hay acciones. Definir explícitamente la matrix de estado→acciones y validar en ambos lados (UI + API).

### #19 — Intl.DateTimeFormat sin timeZone muestra fechas "un día antes" en Argentina
**Error:** `formatDate()` usaba `new Intl.DateTimeFormat('es-AR', {...})` sin `timeZone`. Para fechas `@db.Date` que Prisma serializa como `T00:00:00.000Z`, el browser en UTC-3 mostraba el día anterior (31 de marzo se mostraba como 30 de marzo).
**Lección:** Siempre pasar `timeZone` explícito a `Intl.DateTimeFormat`. Para un sistema argentino: `timeZone: 'America/Argentina/Buenos_Aires'`. Nunca depender del timezone del browser del usuario — puede estar en cualquier zona horaria.

### #20 — Pantalla en blanco en vez de redirect cuando la sesión expira
**Error:** El `DashboardLayout` verificaba `if (!doctor) return null` después del loading. Cuando la sesión expiraba y `/api/auth/me` fallaba, el usuario veía una pantalla en blanco porque el layout renderizaba `null` sin redirigir.
**Lección:** Cuando un componente protegido detecta que no hay sesión, debe redirigir activamente a `/login`, no renderizar nada y esperar que "algo más" se encargue. El middleware de Next.js solo verifica presencia del cookie (no validez), así que la protección real debe estar en el componente.

### #21 — Guard de rol debe chequear null ANTES del role check
**Error:** `if (doctor && doctor.role !== 'ADMIN')` permite que cuando `doctor` es null (loading), la condición sea false y la página admin renderice completa brevemente. El DOCTOR ve flash de la UI admin antes de que el guard active.
**Lección:** Siempre separar los guards en dos: (1) `if (!doctor) return null` para el estado de carga, (2) `if (doctor.role !== 'ADMIN') return <NoAuth/>` para el check de rol. Nunca combinar ambas condiciones en un solo if.

### #22 — UTF-8 BOM rompe parsing de CSV exportado de Excel
**Error:** Excel en Windows agrega BOM (byte EF BB BF / char U+FEFF) al exportar CSV UTF-8. `text.trim()` NO lo remueve. El primer header queda como `\uFEFFfullName` → `indexOf('fullname')` retorna -1 → todas las filas aparecen inválidas con "Nombre requerido".
**Lección:** Siempre strip BOM al inicio del parsing de cualquier archivo de texto: `text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text`. Aplicar a CSV, JSON, y cualquier input de archivos.

### #23 — ApiError.responseBody no se propaga a la UI de errores
**Error:** `err as ImportError` hace un cast directo, pero `ApiError` guarda el body estructurado en `responseBody`, no como propiedades directas. Los errores detallados por fila (`errors: Record<string, ...>`) nunca se mostraban al usuario.
**Lección:** Al capturar `ApiError`, extraer `err.responseBody` explícitamente con `instanceof ApiError` check. Nunca castear el error directamente a la interface de respuesta de la API.

### #24 — Conversaciones sin paciente: access bypass para DOCTOR
**Error:** `if (role === DOCTOR && conversation.patient)` — cuando la conversación no tiene paciente vinculado (patientId null), el check de acceso se skipea y el DOCTOR puede ver mensajes de cualquier conversación sin paciente.
**Lección:** En checks de acceso role-based, el caso `null` del recurso debe denegar acceso (fail closed), no permitirlo. Siempre: `if (role === DOCTOR) { if (!resource) throw NotFound; /* check access */ }`.

### #25 — Load More basado en estado local vs datos del server
**Error:** `hasMorePages = page < data.pagination.pages` usaba `page` del estado local que se incrementa ANTES de que el fetch termine. El botón "Cargar más" desaparece antes de que lleguen los datos. Si el fetch falla, el page ya se incrementó y el usuario no puede reintentar.
**Lección:** Basar condiciones de paginación en `data.pagination.page` (lo que el server confirmó), no en el estado local. Incrementar `page` solo después de un fetch exitoso.

### #26 — Health endpoints que exponen datos operacionales deben estar protegidos
**Error:** `/health/cron` se montó sin autenticación, exponiendo cantidad de pacientes contactados por día y estado operativo del sistema. Para un sistema de salud, esto permite a un atacante inferir volumen de pacientes y timing attacks.
**Lección:** Los health endpoints se dividen en dos categorías: (1) liveness (`/health`) que puede ser público porque solo dice "estoy vivo", y (2) endpoints con datos operacionales (`/health/cron`, `/health/deep`) que deben tener al menos un token de acceso. El principio: si el response contiene datos del negocio (conteos, fechas, duraciones), no es un health check — es un endpoint de operaciones.

### #27 — Prisma CLI es devDependency pero se necesita en producción para migrate deploy
**Error:** El Dockerfile usaba `npm ci --omit=dev` que excluye `prisma` (devDependency), pero `start-api.sh` ejecuta `npx prisma migrate deploy` al arrancar. El container fallaba al iniciar porque `prisma` no existía.
**Lección:** En Docker multi-stage para monorepos con Prisma, NO regenerar el client ni usar el CLI en la imagen de producción. En cambio, copiar `/node_modules/.prisma/`, `/@prisma/client/`, y `/prisma/` desde el builder stage donde sí están instalados.

### #28 — bcrypt native addon requiere build tools en Alpine
**Error:** `npm ci --ignore-scripts` en el Dockerfile suprimía la compilación del addon nativo de `bcrypt`. En Alpine (musl libc), los binarios precompilados no existen, así que bcrypt quedaba roto en runtime.
**Lección:** Si el proyecto usa dependencias con addons nativos (`bcrypt`, `sharp`, `canvas`), NO usar `--ignore-scripts` en el install. Instalar `python3 make g++` en Alpine para la compilación, y limpiar con `apk del` después. Alternativa: migrar a `bcryptjs` (JS puro, sin compilación).

### #29 — orderBy 'asc' con take N retorna los MÁS VIEJOS, no los más recientes
**Error:** `getConversationHistory` usaba `orderBy: { createdAt: 'asc' }, take: 20`. Esto retorna los primeros 20 mensajes cronológicamente, no los últimos 20. Después de 20+ mensajes, el AI recibía contexto irrelevante (los mensajes más viejos).
**Lección:** Para obtener los N más recientes: usar `orderBy: 'desc', take: N` y luego `.reverse()`. Nunca asumir que `asc + take` retorna los más recientes — retorna los más viejos.

### #30 — CSV formula injection: fullName con `=`, `+`, `@` ejecuta código en Excel
**Error:** El campo `fullName` en CSV import y API creation no validaba caracteres iniciales. Un valor como `=CMD('calc')` se almacenaba en la DB y al exportar a Excel ejecutaba código en la máquina del médico.
**Lección:** Siempre sanitizar campos de texto libre que puedan terminar en una planilla: rechazar o escapar valores que empiecen con `=`, `+`, `-`, `@`, `\t`, `\r`. Aplicar en TODAS las vías de entrada (API + CSV).

### #31 — Setear estado ANTES de enviar mensaje rompe el flujo si el envío falla
**Error:** En el flujo de registro del bot, `registrationState.set(phone, ...)` se ejecutaba ANTES de `sendTextMessage()`. Si el envío fallaba (error de red), el estado quedaba seteado pero el usuario nunca recibió el mensaje. En su siguiente mensaje, el bot asumía que estaba en el paso siguiente.
**Lección:** Los side effects de estado deben ejecutarse DESPUÉS de confirmar que la acción que los requiere fue exitosa. Primero enviar, después actualizar estado.

### #32 — Buscar sin debounce genera N requests por cada tecla
**Error:** La búsqueda de pacientes disparaba `fetchPatients` en cada keystroke sin debounce. Escribir "María García" generaba 13 requests al servidor. La página de conversaciones tenía debounce pero pacientes no.
**Lección:** Todo input de búsqueda que dispara fetch necesita debounce (300-500ms). Copiar el patrón donde ya funciona. Es un error fácil de introducir y difícil de notar sin monitoreo.

### #33 — Railway BuildKit no soporta --mount=type=cache sin formato específico
**Error:** El Dockerfile usaba `RUN --mount=type=cache,target=/root/.npm npm ci` y después `--mount=type=cache,id=npm-build,target=/root/.npm`. Railway rechazaba ambos formatos con "Cache mounts MUST be in the format --mount=type=cache,id=<cache-id>" y "Cache mount ID is not prefixed with cache key".
**Lección:** Railway tiene su propio BuildKit con reglas de cache mounts distintas a Docker estándar. La solución más simple es eliminar cache mounts del Dockerfile y confiar en el cache de capas de Docker (COPY package.json primero, source después). Los cache mounts son una optimización, no una necesidad.

### #34 — Prisma en Alpine necesita openssl instalado explícitamente
**Error:** El container Docker con node:20-alpine arrancaba y Prisma fallaba con "failed to detect the libssl/openssl version to use" + "Could not parse schema engine response: SyntaxError". Las migraciones no corrían.
**Lección:** node:20-alpine no incluye openssl. Prisma necesita libssl para conectarse a PostgreSQL. Agregar `apk add --no-cache openssl` en ambos stages del Dockerfile (builder y production).

### #35 — Docker HEALTHCHECK con ${PORT:-3001} no recibe env vars de Railway
**Error:** Railway inyecta `PORT=8080` pero el HEALTHCHECK del Dockerfile usaba `wget http://localhost:${PORT:-3001}/health`. La shell expansion dentro de HEALTHCHECK CMD no recibe las variables de entorno del runtime, así que siempre usaba 3001. Railway mataba el container porque el health check fallaba.
**Lección:** En PaaS como Railway/Render que inyectan PORT dinámicamente, NO usar HEALTHCHECK en el Dockerfile. Dejar que la plataforma maneje los health checks externamente. El HEALTHCHECK de Docker es para Docker standalone, no para PaaS.

### #36 — Railway Trial mata containers por inactividad aunque Serverless esté desactivado
**Error:** La API en Railway arrancaba correctamente (logs mostraban "Server started on port 8080") pero inmediatamente aparecía "Stopping Container". El servicio mostraba "Online" en el dashboard pero devolvía 502 a todos los requests.
**Lección:** Railway Trial ($5 crédito) tiene limitaciones no documentadas que matan containers independientemente del toggle de Serverless. La solución fue migrar a Render Free que sí mantiene el container vivo (aunque lo duerme después de 15 min de inactividad, al menos responde después de ~50s de wake up).

### #37 — Next.js middleware intercepta /api/* y rompe rewrites de proxy
**Error:** El middleware de Next.js tenía un matcher que cubría todas las rutas excepto estáticos. Las requests a `/api/auth/login` (que deberían ser proxied al backend via rewrites) eran interceptadas por el middleware y redirigidas a `/login` porque no tenían cookie de sesión.
**Lección:** En monorepos donde Next.js hace proxy de API calls via `rewrites()`, el middleware DEBE excluir `/api` del matcher: `/((?!api|_next/static|...)*)`. El rewrite es server-side y no tiene cookies del cliente.

### #38 — Sin WHATSAPP_APP_SECRET la API rechaza todos los mensajes de Meta
**Error:** El webhook de WhatsApp estaba verificado y Meta enviaba mensajes, pero la API respondía "Firma inválida" porque `WHATSAPP_APP_SECRET` no estaba configurado. En producción (`NODE_ENV=production`), la verificación HMAC-SHA256 es obligatoria.
**Lección:** Para que el bot de WhatsApp funcione en producción se necesitan 4 variables, no 3: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, y `WHATSAPP_APP_SECRET` (App Secret de Meta → Settings → Basic). Sin el App Secret, todos los mensajes entrantes son rechazados por seguridad.

### #39 — App de WhatsApp en modo test solo envía a números en la lista de permitidos
**Error:** El bot recibía mensajes correctamente (webhook OK, firma OK, parsing OK, AI generaba respuesta), pero `sendTextMessage` fallaba con error 131030: "Recipient phone number not in allowed list". El código no tenía bugs — la app de Meta estaba en modo desarrollo/test.
**Lección:** En modo test, Meta Cloud API solo permite enviar mensajes a números explícitamente agregados en Developer Dashboard → WhatsApp → API Setup → "To". Para producción sin restricción, hay que verificar el negocio en Meta Business Manager. Antes de buscar bugs en el código, verificar el estado de la app en Meta.

### #40 — Números argentinos: Meta envía 549X pero espera 54X al enviar
**Error:** El webhook de WhatsApp enviaba `from: "5493764125878"` (con 9 después de 54). El bot respondía al mismo número, pero Meta rechazaba con error 131030 "not in allowed list". El número estaba en la lista, pero como `543764125878` (sin 9).
**Lección:** Meta Cloud API tiene una inconsistencia con números argentinos: los webhooks envían el formato móvil con 9 (`549XXXXXXXXXX`), pero la API de envío espera el formato sin 9 (`54XXXXXXXXXX`). Siempre normalizar: si empieza con `549` y tiene 13 dígitos, quitar el `9` antes de enviar. Esto aplica solo a Argentina (código 54).
