# IPS — Asistente Preventivo para Pacientes Crónicos
# DOCUMENTO COMPLETO DEL PROYECTO — Todo en un solo lugar

---

## 1. QUÉ ES

Un sistema para el IPS (Instituto de Previsión Social de Misiones) con dos partes:

1. **Bot de WhatsApp** — Atiende consultas de afiliados 24/7 con AI. Envía recordatorios automáticos de controles médicos según el programa de salud del paciente.
2. **Panel web** — Donde los médicos del IPS gestionan pacientes, los inscriben en programas, marcan controles realizados, y ven las conversaciones del bot.

**No es parte de AISolve.** Es un proyecto independiente, con su propia DB, su propio bot, su propio panel.

---

## 2. ARQUITECTURA

Un solo proyecto (monorepo) con todo junto:

```
┌───────────────────────────────────────────────┐
│              Railway (1 servicio)               │
│                                                 │
│  Express.js (Node + TypeScript)                 │
│  ├── API REST (para el panel)                   │
│  ├── Webhook WhatsApp (Meta Cloud API)          │
│  ├── AI (Claude API)                            │
│  └── Cron recordatorios (node-cron, 8:00 AM)   │
│                                                 │
│  PostgreSQL (misma instancia Railway)           │
│  Prisma ORM                                     │
└───────────────────────────────────────────────┘

┌───────────────────────────────────────────────┐
│              Vercel                             │
│  Next.js 14 (App Router)                       │
│  Panel web de médicos                           │
│  Llama a la API de Express                      │
└───────────────────────────────────────────────┘
```

**Sin Redis. Sin BullMQ. Sin microservicios.** Un Express, una DB, un cron.

---

## 3. STACK TECNOLÓGICO

| Pieza | Tecnología |
|-------|-----------|
| Backend | Node.js + TypeScript + Express |
| Frontend | Next.js 14 (App Router) + Tailwind + shadcn/ui |
| DB | PostgreSQL + Prisma |
| Cron | node-cron |
| AI | Claude API (Anthropic SDK) |
| WhatsApp | Meta Cloud API (webhook + templates) |
| Deploy backend | Railway |
| Deploy frontend | Vercel |

**NO se usa:** Redis, BullMQ, microservicios, AISolve, Docker.

---

## 4. ESTRUCTURA DEL MONOREPO

```
apps/
  api/           → Express (API REST + webhook WA + cron)
    src/
      server.ts
      routes/
      controllers/
      services/
      middleware/
      cron/
      webhook/
  web/           → Next.js (panel de médicos)
    src/
      app/
        (auth)/login/
        (dashboard)/
        patients/
        programs/
        doctors/
        conversations/
        import/
packages/
  db/            → Prisma schema + client compartido
    prisma/
      schema.prisma
      seed.ts
  shared/        → tipos, constantes, utilidades compartidas
```

---

## 5. BASE DE DATOS — 8 TABLAS

### doctors
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| fullName | String | |
| email | String UNIQUE | Login |
| passwordHash | String | bcrypt |
| role | Enum: ADMIN, DOCTOR | |
| createdAt | DateTime | |

### doctor_programs (relación médico ↔ programa)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| doctorId | UUID FK → doctors | |
| programId | UUID FK → programs | |
| assignedAt | DateTime | |
| | | UNIQUE(doctorId, programId) |

### patients
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| fullName | String | |
| dni | String UNIQUE | **Clave de deduplicación** |
| phone | String? UNIQUE | WhatsApp E.164, nullable |
| birthDate | Date? | |
| gender | Enum?: M, F, OTRO | |
| consent | Boolean | Opt-in para mensajes |
| registeredVia | Enum: PANEL, BOT, IMPORT | |
| whatsappLinked | Boolean | Teléfono verificado por bot |
| createdAt | DateTime | |

### programs (los 9 oficiales del IPS)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| name | String UNIQUE | |
| description | Text | |
| reminderFrequencyDays | Int | 30, 90, 365, etc. |
| templateMessage | Text | "Hola {{nombre}}, ..." |
| centers | JSON | [{city, name, address}] |

### patient_programs (inscripción paciente ↔ programa)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| patientId | UUID FK → patients | |
| programId | UUID FK → programs | |
| enrolledAt | DateTime | |
| enrolledByDoctorId | UUID FK → doctors | |
| lastControlDate | Date? | |
| nextReminderDate | Date | |
| status | Enum: ACTIVE, PAUSED, COMPLETED | |
| | | UNIQUE(patientId, programId) |

### reminders (historial de recordatorios enviados)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| patientId | UUID FK → patients | |
| programId | UUID FK → programs | |
| message | Text | Mensaje enviado |
| scheduledFor | Date | |
| sentAt | DateTime? | |
| status | Enum: PENDING, SENT, FAILED | |
| patientReplied | Boolean | |

### conversations
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| patientId | UUID FK? → patients | Null si no verificado aún |
| phone | String | |
| status | Enum: OPEN, CLOSED | |
| startedAt | DateTime | |
| closedAt | DateTime? | |

### messages (rows individuales, NO JSON[])
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| conversationId | UUID FK → conversations | |
| role | Enum: USER, ASSISTANT, SYSTEM | |
| content | Text | |
| createdAt | DateTime | |
| | | INDEX(conversationId, createdAt) |

---

## 6. REGLA DE DEDUPLICACIÓN

**DNI es la unique key.** Las 3 vías de entrada hacen UPSERT por DNI:

- **Panel** → médico carga paciente con nombre + DNI (puede no tener teléfono)
- **CSV Import** → admin sube archivo con nombre, DNI, teléfono, programa
- **Bot** → paciente se registra dando nombre + DNI por WhatsApp

**Si el DNI ya existe** → actualiza campos faltantes (ej: vincula teléfono WA)
**Si el DNI no existe** → crea registro nuevo

**Ejemplo:** Admin importa CSV con María García DNI 28456789 sin teléfono. Después María escribe al bot y da su DNI. El sistema encuentra el registro existente y le vincula el teléfono. No crea duplicado.

---

## 7. API ENDPOINTS

### Auth
- `POST /api/auth/login` — email + password → JWT
- `POST /api/auth/refresh` — refresh token
- `GET /api/auth/me` — usuario actual

### Patients
- `GET /api/patients` — listar (search, filtros, paginación)
- `GET /api/patients/:id` — detalle con programas y recordatorios
- `POST /api/patients` — crear (UPSERT por DNI)
- `PATCH /api/patients/:id` — actualizar
- `POST /api/patients/import` — CSV upload + validación + UPSERT masivo

### Programs
- `GET /api/programs` — listar los 9 programas
- `GET /api/programs/:id` — detalle con pacientes inscriptos
- `PATCH /api/programs/:id` — editar template, centros (solo admin)

### Patient Programs
- `POST /api/patients/:id/programs` — inscribir a programa
- `POST /api/patient-programs/:id/control` — marcar control realizado
- `PATCH /api/patient-programs/:id` — cambiar status
- `DELETE /api/patient-programs/:id` — dar de baja

### Doctors (solo admin)
- `GET /api/doctors` — listar
- `POST /api/doctors` — crear
- `PATCH /api/doctors/:id` — editar
- `POST /api/doctors/:id/programs` — asignar a programa
- `DELETE /api/doctors/:id/programs/:programId` — desasignar

### Conversations
- `GET /api/conversations` — listar (filtros)
- `GET /api/conversations/:id/messages` — mensajes paginados

### Dashboard
- `GET /api/dashboard/stats` — métricas generales

### Webhook (Meta)
- `GET /api/webhooks/whatsapp` — verificación Meta
- `POST /api/webhooks/whatsapp` — recibir mensajes

---

## 8. FLUJO DEL BOT

### Paciente nuevo (primera vez que escribe)
1. Paciente escribe "Hola" al WhatsApp del IPS
2. Bot: "Hola, soy el asistente del IPS. ¿Cuál es tu nombre completo?"
3. Paciente: "María García López"
4. Bot: "Gracias María. ¿Cuál es tu número de DNI?"
5. Paciente: "28456789"
6. Sistema: UPSERT por DNI → vincula teléfono WA
7. Si tiene programas: "Estás inscripta en Programa Mujer Sana. ¿En qué puedo ayudarte?"
8. Si no tiene programas: "Ya estás registrada. Un médico completará tu información."
9. A partir de acá → modo chat con AI

### Paciente ya registrado
1. Paciente escribe al bot
2. Sistema busca por teléfono → encuentra paciente
3. Directo a modo chat con AI (sin pedir nombre/DNI de nuevo)

### Modo chat (AI)
- System prompt incluye: datos del paciente, programas inscriptos, centros de atención
- Disclaimer: "Esta información es orientativa. Comuníquese al 0800-888-0109"
- NUNCA evalúa síntomas ni interpreta datos clínicos
- Si escribe "BAJA" → consent = false, deja de recibir recordatorios

---

## 9. CRON DE RECORDATORIOS

Corre todos los días a las 8:00 AM (Argentina, UTC-3):

```
1. Query: pacientes con nextReminderDate <= hoy
   AND status = 'ACTIVE'
   AND consent = true
   AND phone IS NOT NULL

2. Para cada resultado:
   a. Reemplazar {{nombre}} en el template del programa
   b. Enviar mensaje vía Meta Cloud API
   c. Crear registro en tabla reminders (SENT o FAILED)
   d. Recalcular nextReminderDate = hoy + frecuencia del programa
   e. Si falla: status = FAILED, no mover nextReminderDate

3. Log: "Enviados 45 recordatorios. 2 fallidos."
```

---

## 10. PANTALLAS DEL PANEL

| # | Pantalla | Quién la ve | Qué hace |
|---|----------|-------------|----------|
| 1 | Login | Todos | Email + password |
| 2 | Dashboard | Todos | Pacientes activos, recordatorios enviados, tasa de respuesta |
| 3 | Pacientes | Todos | Tabla búsqueda/filtros/paginación. Botón "Nuevo" + "Importar CSV" |
| 4 | Ficha Paciente | Todos | Datos + programas + "Marcar control realizado" + recordatorios + conversaciones |
| 5 | Programas | Solo Admin | 9 programas, inscriptos, editar template/centros |
| 6 | Importar CSV | Solo Admin | Drag & drop, preview, validación, confirmación |
| 7 | Médicos | Solo Admin | CRUD + asignar a programas |
| 8 | Conversaciones | Todos | Chats del bot, filtro por paciente/programa |

---

## 11. LOS 9 PROGRAMAS OFICIALES DEL IPS

| # | Programa | Frecuencia | Template |
|---|----------|-----------|----------|
| 1 | Diabetes | 3 meses | Hemoglobina glicosilada, cobertura 100% lab IPS |
| 2 | Mujer Sana | 12 meses | Mamografía + PAP, chequera gratuita |
| 3 | Hombre Sano | 12 meses | PSA + ecografía, chequera |
| 4 | PREDHICAR (Hipertensión) | 1 mes | Control presión arterial, farmacia propia |
| 5 | Osteoporosis | 12 meses | Densitometría ósea, 4 centros |
| 6 | Oncológico | 3/6/12 meses | Control oncológico, cobertura 100% |
| 7 | Celíacos | 12 meses | Control anual, cobertura harinas especiales |
| 8 | Cáncer de Colon | 12 meses | Screening sangre oculta |
| 9 | Plan Materno Infantil | Según gestación | Control prenatal, cobertura parto |

---

## 12. SEGURIDAD

- **Sin historia clínica ni texto libre** — Solo nombre, DNI, teléfono, programa, fechas de control
- **No existe tabla medical_notes** — Eliminada por diseño. Texto libre = historia clínica de facto
- **El médico solo puede "marcar control realizado"** — Una fecha, nada más
- **JWT** — httpOnly cookie, sin Redis. Token 15 min, refresh 7 días
- **bcrypt** — Contraseñas hasheadas
- **HTTPS** — Obligatorio en producción
- **Consentimiento** — Opt-in antes de enviar mensajes. "BAJA" para desuscribirse
- **Disclaimer** — En cada conversación del bot
- **Auditoría** — Log de accesos a datos de pacientes
- **CORS** — Solo el dominio del panel

---

## 13. ROLES Y PERMISOS

| Acción | Admin | Doctor |
|--------|-------|--------|
| Ver pacientes de sus programas | Si | Si |
| Ver TODOS los pacientes | Si | No |
| Crear/editar pacientes | Si | Si |
| Importar CSV | Si | No |
| Editar programas | Si | No |
| Gestionar médicos | Si | No |
| Marcar control realizado | Si | Si |
| Ver conversaciones | Si | Si (sus programas) |
| Ver dashboard | Si | Si (sus programas) |

---

## 14. VARIABLES DE ENTORNO

```
DATABASE_URL=postgresql://postgres:password@localhost:5432/ips_asistente
JWT_SECRET=cambiar-por-un-secret-seguro
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
WHATSAPP_ACCESS_TOKEN=tu-token-de-meta
WHATSAPP_PHONE_NUMBER_ID=tu-phone-number-id
WHATSAPP_VERIFY_TOKEN=un-string-para-verificacion
WHATSAPP_APP_SECRET=tu-app-secret
ANTHROPIC_API_KEY=sk-ant-api03-xxx
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
REMINDER_CRON=0 11 * * *
```

---

## 15. DATOS DE SEED (PARA DESARROLLO Y DEMO)

- **1 admin:** admin@ips.gob.ar / Admin2026!
- **5 médicos:** cada uno asignado a 2 programas
- **9 programas** con templates y centros de atención reales de Misiones
- **50 pacientes fake** con nombres, DNIs, teléfonos y programas realistas
- Todos con consent=true, registeredVia=IMPORT

---

## 16. PLAN DE IMPLEMENTACIÓN — 10 PASOS

### Paso 1 — Monorepo + config base
- Inicializar git repo
- Crear estructura apps/api/, apps/web/, packages/db/
- package.json raíz con workspaces
- tsconfig base compartido
- .env.example

### Paso 2 — Prisma schema + DB
- schema.prisma con las 8 tablas
- Primera migración
- Seed: 9 programas + admin + 5 médicos + 50 pacientes

### Paso 3 — API Express base + Auth
- Express + TypeScript
- Middleware: CORS, helmet, JSON parser
- Auth: login, JWT, bcrypt, requireAuth, requireAdmin
- Zod validation

### Paso 4 — CRUD Pacientes + Deduplicación
- GET/POST/PATCH /patients con UPSERT por DNI
- Búsqueda, filtros, paginación
- Import CSV masivo

### Paso 5 — Programas + Inscripciones + Control
- CRUD programas
- Inscribir paciente a programa
- Marcar control realizado → recalcular nextReminderDate
- CRUD doctors + doctor_programs

### Paso 6 — Webhook WhatsApp + Bot
- Webhook verificación + recibir mensajes
- Flujo registro: nombre → DNI → UPSERT
- Chat AI con Claude + disclaimer
- "BAJA" → consent = false

### Paso 7 — Cron de recordatorios
- node-cron 8:00 AM
- Query pacientes pendientes
- Enviar template Meta Cloud API
- Registro en tabla reminders

### Paso 8 — Panel web — Pantallas core
- Next.js 14 + Tailwind + shadcn/ui
- Login, Dashboard, Pacientes, Ficha paciente

### Paso 9 — Panel web — Pantallas admin
- Programas, Médicos, Importar CSV, Conversaciones

### Paso 10 — Deploy + Test end-to-end
- Deploy Railway + Vercel
- Webhook Meta producción
- Templates aprobados por Meta
- Test completo: bot → panel → control → recordatorio

---

## 17. DECISIONES DE DISEÑO (LECCIONES APRENDIDAS)

| # | Decisión | Por qué |
|---|----------|---------|
| 1 | Sin medical_notes | Texto libre = historia clínica de facto. Riesgo legal innecesario |
| 2 | Messages como rows | JSON[] no se puede buscar, filtrar, ni paginar eficientemente |
| 3 | doctor_programs como tabla | UUID[] es antipattern en PostgreSQL |
| 4 | Sin Redis/BullMQ | Para piloto de cientos de pacientes, node-cron alcanza |
| 5 | Solo 9 programas oficiales | No inventar programas que el IPS no tiene |
| 6 | UPSERT por DNI | 3 vías de entrada necesitan una regla clara de deduplicación |
| 7 | Proyecto separado de AISolve | Más simple, sin dependencias, total control |
| 8 | Verificar tokens antes de asumir | Caches en memoria no se invalidan solos |

---

## 18. FUERA DE ALCANCE (NO SE HACE)

- Telemedicina / videollamadas
- Recetas electrónicas
- Historia clínica electrónica
- Integración con Alegramed
- App móvil nativa
- Multi-idioma (solo español)

---

## 19. ARCHIVOS DEL PROYECTO

```
ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/
├── .claude/
│   └── settings.json       ← hooks que obligan a leer reglas antes de codear
├── .gitignore
├── .env.example             ← todas las variables
├── CLAUDE.md                ← 3 reglas obligatorias para Claude
├── LESSONS.md               ← errores cometidos, no repetir
├── STATUS.md                ← estado actual del proyecto
├── PROYECTO-COMPLETO.md     ← ESTE ARCHIVO — todo en un lugar
├── spec.md                  ← spec técnica detallada
├── plan.md                  ← 10 pasos con checklist
├── seed-data.md             ← 50 pacientes + 5 médicos + centros
└── mapa-sistema.html        ← mapa visual interactivo
```

---

## 20. CÓMO RETOMAR EN UNA NUEVA SESIÓN

1. Abrir Claude Code en la carpeta del proyecto
2. Claude lee automáticamente CLAUDE.md (3 reglas)
3. Hook de SessionStart le recuerda leer LESSONS.md y STATUS.md
4. Hook de PreToolUse BLOQUEA ediciones si no leyó los 3 archivos
5. STATUS.md dice en qué paso estamos y cuál es la próxima acción
6. plan.md tiene el checklist de lo que falta

**Todo está guardado en archivos. Nada se pierde entre sesiones.**
