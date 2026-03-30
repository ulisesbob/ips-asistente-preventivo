# IPS — Asistente Preventivo para Pacientes Crónicos

## Spec v1.1 — 2026-03-30

---

## Qué es

Un sistema para el IPS (Instituto de Previsión Social de Misiones) que tiene dos partes:

1. **Bot de WhatsApp** — Atiende consultas de afiliados 24/7 con AI. Envía recordatorios automáticos de controles médicos según el programa de salud en el que está inscripto el paciente.
2. **Panel web** — Donde los médicos del IPS gestionan pacientes, los inscriben en programas, marcan controles realizados, y ven las conversaciones del bot.

## Arquitectura

Un solo proyecto (monorepo) con 3 piezas en el mismo servidor:

```
┌───────────────────────────────────────────────┐
│              Railway (1 servicio)               │
│                                                 │
│  Express.js (Node + TypeScript)                 │
│  ├── API REST (panel)                           │
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

**Sin Redis. Sin BullMQ. Sin microservicios.** Un Express, una DB, un cron. Se agrega complejidad si escala.

## Stack

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

## Base de datos

### doctors
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| fullName | String | |
| email | String UNIQUE | Login |
| passwordHash | String | bcrypt |
| role | Enum: ADMIN, DOCTOR | |
| createdAt | DateTime | |

### doctor_programs
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
| dni | String UNIQUE | Clave de deduplicación |
| phone | String? UNIQUE | WhatsApp E.164, nullable |
| birthDate | Date? | |
| gender | Enum?: M, F, OTRO | |
| consent | Boolean | Opt-in para mensajes |
| registeredVia | Enum: PANEL, BOT, IMPORT | |
| whatsappLinked | Boolean | Teléfono verificado por bot |
| createdAt | DateTime | |

### programs
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| name | String UNIQUE | |
| description | Text | |
| reminderFrequencyDays | Int | 30, 90, 365, etc. |
| templateMessage | Text | "Hola {{nombre}}, ..." |
| centers | JSON | [{city, name, address}] |

### patient_programs
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

### reminders
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

### messages
| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| conversationId | UUID FK → conversations | |
| role | Enum: USER, ASSISTANT, SYSTEM | |
| content | Text | |
| createdAt | DateTime | |
| | | INDEX(conversationId, createdAt) |

## Regla de deduplicación

DNI es la unique key. Las 3 vías de entrada (panel, CSV, bot) hacen UPSERT por DNI:

- **Si el DNI ya existe** → actualiza campos faltantes (ej: vincula teléfono WA)
- **Si el DNI no existe** → crea registro nuevo

Ejemplo: Admin importa CSV con María García DNI 28456789 sin teléfono. María escribe al bot, da su DNI. El sistema encuentra el registro existente y vincula el teléfono. No crea duplicado.

## API Endpoints

### Auth
- `POST /api/auth/login` — email + password → JWT
- `POST /api/auth/refresh` — refresh token
- `GET /api/auth/me` — usuario actual

### Patients
- `GET /api/patients` — listar (con search, filtros por programa/status, paginación)
- `GET /api/patients/:id` — detalle con programas, notas, recordatorios
- `POST /api/patients` — crear (UPSERT por DNI)
- `PATCH /api/patients/:id` — actualizar
- `POST /api/patients/import` — CSV upload, validación, UPSERT masivo

### Programs
- `GET /api/programs` — listar los 9 programas
- `GET /api/programs/:id` — detalle con pacientes inscriptos
- `PATCH /api/programs/:id` — editar template, centros (solo admin)

### Patient Programs (inscripciones)
- `POST /api/patients/:id/programs` — inscribir paciente a programa
- `POST /api/patient-programs/:id/control` — marcar control realizado (actualiza lastControlDate, recalcula nextReminderDate)
- `PATCH /api/patient-programs/:id` — cambiar status (ACTIVE/PAUSED/COMPLETED)
- `DELETE /api/patient-programs/:id` — dar de baja

### Doctors (solo admin)
- `GET /api/doctors` — listar
- `POST /api/doctors` — crear
- `PATCH /api/doctors/:id` — editar
- `POST /api/doctors/:id/programs` — asignar a programa
- `DELETE /api/doctors/:id/programs/:programId` — desasignar

### Conversations
- `GET /api/conversations` — listar (filtros por paciente, programa)
- `GET /api/conversations/:id/messages` — mensajes paginados

### Dashboard
- `GET /api/dashboard/stats` — métricas generales

### Webhook (Meta)
- `GET /api/webhooks/whatsapp` — verificación Meta
- `POST /api/webhooks/whatsapp` — recibir mensajes

## Flujo del bot

### Paciente nuevo (no registrado)
1. Paciente escribe al bot
2. Bot: "Hola, soy el asistente del IPS. ¿Cuál es tu nombre completo?"
3. Paciente responde nombre
4. Bot: "Gracias. ¿Cuál es tu número de DNI?"
5. Paciente responde DNI
6. Sistema hace UPSERT por DNI, vincula teléfono
7. Si tiene programas: "Estás inscripta en Programa Mujer Sana. ¿En qué puedo ayudarte?"
8. Si no tiene programas: "Ya estás registrada. Un médico completará tu información."
9. A partir de acá → modo chat con AI

### Paciente ya registrado
1. Paciente escribe al bot
2. Sistema busca por teléfono → encuentra paciente
3. Directo a modo chat con AI (sin pedir nombre/DNI de nuevo)

### Modo chat (AI)
- System prompt incluye: datos del paciente, programas inscriptos, centros de atención del programa
- Disclaimer: "Esta información es orientativa. Para consultas sobre su caso, comuníquese al 0800-888-0109"
- NUNCA evalúa síntomas ni interpreta datos clínicos
- Si el paciente escribe "BAJA" → consent = false, deja de recibir recordatorios

## Cron de recordatorios

Corre todos los días a las 8:00 AM (Argentina, UTC-3):

```
1. Query: SELECT patient_programs JOIN patients JOIN programs
   WHERE nextReminderDate <= hoy
   AND status = 'ACTIVE'
   AND patient.consent = true
   AND patient.phone IS NOT NULL

2. Para cada resultado:
   a. Interpolar template: reemplazar {{nombre}} con patient.fullName
   b. Enviar mensaje vía Meta Cloud API (template message)
   c. Crear registro en tabla reminders (status: SENT)
   d. Calcular nextReminderDate = hoy + program.reminderFrequencyDays
   e. Si falla el envío: status = FAILED, no mover nextReminderDate

3. Log: "Enviados 45 recordatorios. 2 fallidos."
```

## Pantallas del panel

1. **Login** — email + password
2. **Dashboard** — pacientes activos, recordatorios enviados hoy/semana/mes, tasa de respuesta
3. **Pacientes** — tabla con búsqueda por nombre/DNI, filtros por programa/estado, paginación
4. **Ficha paciente** — datos personales, programas inscriptos (con botón "marcar control realizado"), historial de recordatorios, conversaciones del bot
5. **Programas** — los 9 programas con inscriptos, frecuencia, template, centros (admin edita)
6. **Importar CSV** — drag & drop, preview, validación, confirmación (solo admin)
7. **Médicos** — CRUD + asignar a programas (solo admin)
8. **Conversaciones** — chats del bot, filtro por paciente/programa, mensajes paginados

## Los 9 programas oficiales del IPS

| Programa | Frecuencia |
|----------|-----------|
| Diabetes | 3 meses |
| Mujer Sana | 12 meses |
| Hombre Sano | 12 meses |
| PREDHICAR (Hipertensión) | 1 mes |
| Osteoporosis | 12 meses |
| Oncológico | 3/6/12 meses (configurable) |
| Celíacos | 12 meses |
| Cáncer de Colon | 12 meses |
| Plan Materno Infantil | según semana de gestación |

## Seguridad

- **Sin historia clínica ni notas de texto libre** — Solo nombre, DNI, teléfono, programa, fechas de control. Nunca diagnósticos, resultados, ni texto libre del médico. El médico solo puede "marcar control realizado" (fecha).
- **JWT** — httpOnly cookie, sin Redis. Token expira en 15 min, refresh en 7 días.
- **bcrypt** — Contraseñas hasheadas.
- **HTTPS** — Obligatorio en producción.
- **Consentimiento** — Opt-in antes de enviar mensajes. "BAJA" para desuscribirse.
- **Disclaimer** — En cada conversación del bot.
- **Auditoría** — Log de accesos a datos de pacientes.
- **CORS** — Solo el dominio del panel.

## Roles y permisos

| Acción | Admin | Doctor |
|--------|-------|--------|
| Ver pacientes de sus programas | ✅ | ✅ |
| Ver TODOS los pacientes | ✅ | ❌ |
| Crear/editar pacientes | ✅ | ✅ |
| Importar CSV | ✅ | ❌ |
| Editar programas | ✅ | ❌ |
| Gestionar médicos | ✅ | ❌ |
| Marcar control realizado | ✅ | ✅ |
| Ver conversaciones | ✅ | ✅ (sus programas) |
| Ver dashboard | ✅ | ✅ (sus programas) |

## Fuera de alcance (no se hace)

- Telemedicina / videollamadas
- Recetas electrónicas
- Historia clínica electrónica
- Integración con Alegramed
- App móvil nativa
- Multi-idioma (solo español)
