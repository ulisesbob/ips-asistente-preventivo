# IPS — Asistente Preventivo para Pacientes Crónicos

## Estado actual
- **Último paso completado:** Paso 19 — Recordatorios autogestivos del paciente
- **Estado:** PRODUCCIÓN ACTIVA — Render (API) + Vercel (Panel) + WhatsApp Bot
- **Bot:** Claude Sonnet 4.6 + fallback Haiku 4.5, personalidad "Ana", 30 FAQs reales IPS
- **UptimeRobot:** Configurado — ping cada 5 min a /health
- **Bloqueadores:** Ninguno activo
- **Fecha:** 10 de abril de 2026

---

## Qué es

Sistema para el IPS (Instituto de Previsión Social de Misiones) con dos partes:

1. **Bot de WhatsApp con IA** — Atiende consultas de afiliados 24/7, envía recordatorios automáticos de controles y medicación, y permite al paciente crear sus propios recordatorios desde el chat.
2. **Panel web para médicos** — Gestión de pacientes, programas de salud, recordatorios, conversaciones del bot, notas operativas, importación CSV, alertas y exportación de datos.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + TypeScript + Express |
| Frontend | Next.js 14 (App Router) + Tailwind CSS + shadcn/ui |
| Base de datos | PostgreSQL (Neon serverless) + Prisma ORM |
| IA | Claude Sonnet 4.6 (primario) + Haiku 4.5 (fallback) |
| WhatsApp | Meta Cloud API (webhook + envío) |
| Cron | node-cron (4 jobs activos) |
| Deploy API | Render (Docker, node:20-alpine, dumb-init) |
| Deploy Panel | Vercel (Next.js standalone) |
| Monitoreo | UptimeRobot (ping /health cada 5 min) |

---

## Features implementadas (26 en total)

### Core (Pasos 1-10)
| # | Feature | Descripción |
|---|---------|-------------|
| 1 | Monorepo + config | Workspaces npm, tsconfig compartido, .env |
| 2 | Base de datos | 12 tablas PostgreSQL, Prisma ORM, migraciones |
| 3 | API + Auth | Express REST, JWT (access 15min + refresh 7d), bcrypt, Zod |
| 4 | Pacientes | CRUD, búsqueda, filtros, paginación, UPSERT por DNI |
| 5 | Programas | 9 programas oficiales IPS, inscripciones, marcar control |
| 6 | Bot WhatsApp | Registro por chat, AI conversacional, "BAJA"/"ALTA" |
| 7 | Cron recordatorios | Diario 8AM, envía WA a pacientes con control vencido |
| 8 | Panel — Core | Login, dashboard, lista pacientes, ficha paciente |
| 9 | Panel — Admin | Programas, médicos, importar CSV, conversaciones |
| 10 | Deploy | Docker multi-stage, CI/CD automático, seed producción |

### Features avanzadas (Pasos 11-19)
| # | Feature | Descripción |
|---|---------|-------------|
| 11 | Notas operativas | Médico agrega notas por paciente (max 500 chars, sin datos clínicos) |
| 12 | Control editable | Médico cambia fecha de próximo control manualmente |
| 13 | Alertas | Semáforo: control vencido (amarillo/rojo), sin respuesta, bajas |
| 14 | Exportar CSV | Descarga filtrada de pacientes con sanitización anti-injection |
| 15 | Editar paciente | Dialog para nombre, teléfono, fecha nacimiento, género |
| 16 | Base de conocimiento | 30 FAQs reales del IPS, CRUD admin, bot las consulta por keywords |
| 17 | Derivación humano | Escalamiento a operador, chat desde panel, indicador en nav |
| 18 | Encuestas | Post-control: "¿Pudiste ir?" + rating 1-5, métricas en dashboard |
| 19 | Recordatorios autogestivos | Paciente crea recordatorios diarios de medicación desde el bot |

### Extras
| Feature | Descripción |
|---------|-------------|
| Recordatorios de medicación | Diarios, configurados por médico o paciente, cron cada 30 min |
| Bot "Ana" | Personalidad argentina, Sonnet 4.6 + retry 2x + fallback Haiku |
| KB datos reales | Scrapeado de ipsmisiones.com.ar, 30 FAQs verificadas |
| Deduplicación webhooks | Meta reenvía cuando el server estaba caído, Set in-memory |
| Inscripción presencial | Bot explica cómo inscribirse, no inscribe (solo médico) |

---

## Bot — Capacidades

### Lo que el bot puede hacer
- Responder preguntas sobre coberturas, trámites, programas, urgencias (30 FAQs)
- Dar fechas exactas de próximo control y centros de atención
- Informar medicación activa del paciente (nombre, dosis, horario)
- Crear recordatorios diarios de medicación por pedido del paciente (flujo paso a paso)
- Explicar cómo inscribirse presencialmente en programas
- Escalar a operador humano cuando el paciente lo pide
- Enviar encuestas de satisfacción post-control
- Registrar pacientes nuevos (nombre + DNI → UPSERT)
- Procesar "BAJA" (dejar de recibir mensajes) y "ALTA" (reactivar)

### Lo que el bot NO hace (por diseño)
- NUNCA evalúa síntomas ni recomienda tratamientos
- NUNCA revela notas internas de médicos al paciente
- NUNCA inscribe pacientes en programas (solo presencial)
- NUNCA almacena datos clínicos (solo nombre, DNI, teléfono, programa, fechas)

### Configuración técnica
- Modelo primario: Claude Sonnet 4.6
- Fallback: Claude Haiku 4.5 (si Sonnet está saturado)
- Retry: 2 intentos con Sonnet, delay 2s, luego Haiku
- Max tokens: 512 por respuesta
- Historial: últimos 6 mensajes por conversación
- Concurrencia: máx 50 llamadas AI simultáneas
- Rate limit: 100ms entre envíos WhatsApp

---

## Panel web — Pantallas

| Pantalla | Acceso | Descripción |
|----------|--------|-------------|
| Login | Todos | Email + password, JWT httpOnly |
| Dashboard | Todos | Pacientes activos, recordatorios enviados, alertas semáforo, encuestas |
| Pacientes | Todos | Tabla con búsqueda nombre/DNI, filtros programa/estado, paginación |
| Ficha paciente | Todos | Datos, programas, marcar control, recordatorios medicación, notas, conversaciones |
| Programas | Admin | 9 programas IPS, editar template, centros de atención |
| Médicos | Admin | CRUD médicos, asignar/desasignar programas |
| Importar CSV | Admin | Drag & drop, preview, validación, UPSERT masivo |
| Conversaciones | Todos | Chats del bot, filtro estado, responder escaladas |
| Base de conocimiento | Admin | CRUD FAQs del IPS para el bot |

### Roles y permisos
| Acción | Admin | Doctor |
|--------|-------|--------|
| Ver todos los pacientes | ✅ | ❌ (solo sus programas) |
| Crear/editar pacientes | ✅ | ✅ |
| Importar CSV | ✅ | ❌ |
| Gestionar médicos | ✅ | ❌ |
| Editar programas | ✅ | ❌ |
| Marcar control | ✅ | ✅ |
| Ver conversaciones | ✅ | ✅ (sus programas) |
| Gestionar KB | ✅ | ❌ |

---

## Crons activos

| Cron | Frecuencia | Qué hace |
|------|-----------|----------|
| Recordatorios de controles | Diario 8:00 AM Argentina | Envía WA a pacientes con nextReminderDate vencida |
| Recordatorios de medicación | Cada 30 min | Envía WA según hora configurada (médico o paciente) |
| Encuestas post-control | Diario 10:00 AM Argentina | Envía encuesta WA 24h después de control marcado |
| Recordatorios autogestivos | Cada 30 min | Envía recordatorios puntuales creados por pacientes |

---

## Base de datos — 12 tablas

| Tabla | Propósito |
|-------|----------|
| doctors | Médicos/admins del panel |
| doctor_programs | Asignación médico ↔ programa (M:N) |
| patients | Afiliados del IPS |
| programs | 9 programas oficiales de salud |
| patient_programs | Inscripción paciente ↔ programa con fechas de control |
| reminders | Historial de recordatorios enviados por cron |
| conversations | Conversaciones del bot (OPEN/ESCALATED/CLOSED) |
| messages | Mensajes individuales de cada conversación |
| patient_notes | Notas operativas de médicos (max 500 chars) |
| knowledge_base | FAQs del IPS para el bot (30 entradas) |
| surveys | Encuestas post-control (asistencia + rating) |
| medication_reminders | Recordatorios diarios de medicación (médico o paciente) |
| patient_self_reminders | Recordatorios puntuales creados por el paciente |

---

## API — Endpoints

### Autenticación
- `POST /api/auth/login` — Email + password → JWT
- `POST /api/auth/refresh` — Renovar access token
- `GET /api/auth/me` — Perfil del usuario actual

### Pacientes
- `GET /api/patients` — Listar con búsqueda, filtros, paginación
- `GET /api/patients/:id` — Detalle con programas, recordatorios, conversaciones
- `POST /api/patients` — Crear (UPSERT por DNI)
- `PATCH /api/patients/:id` — Actualizar datos
- `POST /api/patients/import` — Importar CSV
- `GET /api/patients/export` — Exportar CSV filtrado
- `GET /api/patients/:id/self-reminders` — Recordatorios autogestivos

### Programas e inscripciones
- `GET /api/programs` — Listar los 9 programas
- `GET /api/programs/:id` — Detalle con pacientes inscriptos
- `PATCH /api/programs/:id` — Editar template/centros
- `POST /api/patients/:id/programs` — Inscribir paciente
- `POST /api/patient-programs/:id/control` — Marcar control realizado
- `PATCH /api/patient-programs/:id` — Cambiar estado
- `PATCH /api/patient-programs/:id/next-control` — Cambiar fecha próximo control

### Médicos (admin)
- `GET /api/doctors` — Listar
- `POST /api/doctors` — Crear
- `PATCH /api/doctors/:id` — Editar
- `POST /api/doctors/:id/programs` — Asignar a programa

### Medicación
- `GET /api/patients/:id/medications` — Listar recordatorios
- `POST /api/patients/:id/medications` — Crear recordatorio
- `PATCH /api/medication-reminders/:id` — Editar/pausar
- `DELETE /api/medication-reminders/:id` — Eliminar

### Notas
- `GET /api/patients/:id/notes` — Listar notas paginadas
- `POST /api/patients/:id/notes` — Crear nota operativa

### Conversaciones
- `GET /api/conversations` — Listar con filtros
- `GET /api/conversations/:id/messages` — Mensajes paginados
- `POST /api/conversations/:id/reply` — Responder desde panel

### Dashboard
- `GET /api/dashboard/stats` — Métricas generales
- `GET /api/dashboard/alerts` — Alertas y pacientes en riesgo
- `GET /api/dashboard/surveys` — Métricas de satisfacción

### Base de conocimiento
- `GET /api/knowledge` — Listar FAQs
- `POST /api/knowledge` — Crear entrada
- `PATCH /api/knowledge/:id` — Editar
- `DELETE /api/knowledge/:id` — Eliminar

### WhatsApp webhook
- `GET /api/webhooks/whatsapp` — Verificación Meta
- `POST /api/webhooks/whatsapp` — Recibir mensajes

### Health
- `GET /health` — Liveness check (público)
- `GET /health/deep` — DB connectivity (protegido)
- `GET /health/cron` — Estado del cron (protegido)

---

## Seguridad

### Medidas implementadas
- JWT httpOnly cookies (access 15min + refresh 7d)
- bcrypt para contraseñas
- CORS restringido al dominio del panel
- Helmet headers de seguridad
- Zod validation en TODOS los endpoints
- HMAC-SHA256 verificación de webhooks WhatsApp
- Sanitización CSV injection en todas las vías de entrada
- Defensa contra prompt injection (strip `<>`, notas confidenciales con doble barrera)
- Deduplicación de webhooks Meta (Set in-memory, 5000 IDs)
- Rate limiting en webhook (1000 req/min por IP)
- Verificación timing-safe de tokens

### Sin datos clínicos (por diseño)
- Solo: nombre, DNI, teléfono, programa, fechas de control
- NUNCA: diagnósticos, resultados, tratamientos, historia clínica
- Notas operativas limitadas a 500 chars con disclaimer obligatorio
- El bot incluye notas en contexto pero NUNCA las revela al paciente

### Auditorías completadas
- 8 code reviews con agentes especializados
- 3 security audits completos
- 2 análisis profundos de bugs (frontend + backend, 23 bugs resueltos)
- 1 regression review completo (20 features verificadas)
- react-doctor: 97/100 (0 errores)

---

## Testing

- **267 tests unitarios**, 11 archivos, todo verde
- Cobertura: auth, middleware, phone normalization, CSV sanitization, escalation detection, survey parsing, medication slots, KB keywords, self-reminder parsing, self-reminder validation

---

## 9 Programas oficiales del IPS

| Programa | Frecuencia de control |
|----------|----------------------|
| Diabetes | Cada 3 meses |
| Mujer Sana | Cada 12 meses |
| Hombre Sano | Cada 12 meses |
| PREDHICAR (Hipertensión) | Cada 1 mes |
| Osteoporosis | Cada 12 meses |
| Oncológico | 3/6/12 meses (configurable) |
| Celíacos | Cada 12 meses |
| Cáncer de Colon | Cada 12 meses |
| Plan Materno Infantil | Según semana de gestación |

---

## Infra y deploy

```
┌───────────────────────────────────────────────┐
│              Render (1 servicio)               │
│                                               │
│  Express.js (Node + TypeScript)               │
│  ├── API REST (panel)                         │
│  ├── Webhook WhatsApp (Meta Cloud API)        │
│  ├── AI (Claude Sonnet 4.6 + Haiku fallback)  │
│  ├── Cron controles (8:00 AM Argentina)       │
│  ├── Cron medicación (cada 30 min)            │
│  ├── Cron encuestas (10:00 AM Argentina)      │
│  └── Cron self-reminders (cada 30 min)        │
│                                               │
│  PostgreSQL (Neon serverless)                 │
│  Prisma ORM                                  │
└───────────────────────────────────────────────┘

┌───────────────────────────────────────────────┐
│              Vercel                           │
│  Next.js 14 (App Router, standalone)          │
│  Panel web de médicos                         │
│  Proxy API via rewrites                       │
└───────────────────────────────────────────────┘
```

---

## Lecciones aprendidas

55 lecciones documentadas en LESSONS.md. Temas principales:
- Manejo de timezones (Argentina UTC-3)
- Normalización de teléfonos argentinos para Meta API
- Deduplicación de webhooks
- CSV injection prevention
- Prompt engineering para bots de salud
- Prisma en Docker Alpine (openssl, bcrypt)
- Deploy en PaaS (Render/Vercel)
- Seguridad en sistemas de salud

---

## Pendientes

1. **Verificación de negocio en Meta** — Para enviar a cualquier número sin lista blanca
2. **Templates de mensaje aprobados** — Para recordatorios proactivos fuera de ventana 24h
3. **Render Starter ($7/mes)** — Si el free tier sigue matando el container

---

## Historial

| Fecha | Qué se hizo |
|-------|-------------|
| 2026-03-30 | Pasos 0-10: Spec, monorepo, DB, API, bot, crons, panel, deploy producción |
| 2026-03-31 | Pasos 11-15: Notas, control editable, alertas, exportar CSV, editar paciente |
| 2026-03-31 | Pasos 16-18: KB (30 FAQs reales), derivación humano, encuestas post-control |
| 2026-03-31 | Extras: Recordatorios medicación, bot Sonnet 4.6 + "Ana", KB ipsmisiones.com.ar |
| 2026-03-31 | Bug fixes: Deduplicación webhooks, retry+fallback, phone normalization, guards |
| 2026-03-31 | Reviews: 5 code reviews, 2 security audits, 2 deep bug hunts, 140 tests |
| 2026-03-31 | Infra: UptimeRobot, escalabilidad 500 pacientes, PDF presentación |
| 2026-04-10 | Paso 19: Recordatorios autogestivos — flujo determinístico bot, cron, 267 tests |
| 2026-04-10 | 4 agents review (code/security/perf/arch): 7 findings, todos arreglados |
| 2026-04-10 | Regression review completo: 20 features verificadas, 0 regresiones |
| 2026-04-10 | Fix: recordatorios del bot van a misma tabla medicación, UI unificada |
