# Plan de Implementación — IPS Asistente Preventivo

## Orden de ejecución

Cada paso depende del anterior. No saltar pasos.

---

### Paso 1 — Monorepo + config base ✅
- [x] Inicializar repo git
- [x] Crear estructura `apps/api/`, `apps/web/`, `packages/db/`
- [x] package.json raíz con workspaces
- [x] tsconfig base compartido
- [x] .env.example con todas las variables necesarias

### Paso 2 — Prisma schema + DB ✅
- [x] Escribir `packages/db/prisma/schema.prisma` con las 8 tablas de spec.md
- [x] Configurar PostgreSQL (Railway dev o local)
- [x] Correr primera migración
- [x] Seed: 9 programas oficiales del IPS + 1 admin de prueba

### Paso 3 — API Express base + Auth ✅
- [x] Express + TypeScript en `apps/api/`
- [x] Middleware: CORS, helmet, JSON parser
- [x] Auth: login, JWT (access 15min + refresh 7d), bcrypt
- [x] Middleware `requireAuth` y `requireAdmin`
- [x] POST /auth/login, POST /auth/refresh, GET /auth/me
- [x] Zod validation en todos los endpoints

### Paso 4 — CRUD Pacientes + Deduplicación
- [ ] GET /patients (búsqueda nombre/DNI, filtros programa/status, paginación)
- [ ] GET /patients/:id (con programas y recordatorios)
- [ ] POST /patients (UPSERT por DNI)
- [ ] PATCH /patients/:id
- [ ] POST /patients/import (CSV upload + validación + UPSERT masivo)

### Paso 5 — Programas + Inscripciones + Control
- [ ] GET /programs, GET /programs/:id, PATCH /programs/:id
- [ ] POST /patients/:id/programs (inscribir a programa)
- [ ] POST /patient-programs/:id/control (marcar control → recalcular nextReminderDate)
- [ ] PATCH /patient-programs/:id (cambiar status)
- [ ] DELETE /patient-programs/:id (dar de baja)
- [ ] CRUD doctors + doctor_programs (solo admin)

### Paso 6 — Webhook WhatsApp + Bot
- [ ] GET /webhooks/whatsapp (verificación Meta)
- [ ] POST /webhooks/whatsapp (recibir mensajes)
- [ ] Flujo registro: pedir nombre → pedir DNI → UPSERT → vincular teléfono
- [ ] Flujo chat: buscar paciente por teléfono → modo AI con Claude
- [ ] System prompt: datos paciente + programas + centros + disclaimer
- [ ] "BAJA" → consent = false
- [ ] Tabla conversations + messages (rows individuales)

### Paso 7 — Cron de recordatorios
- [ ] node-cron todos los días 8:00 AM (UTC-3)
- [ ] Query: nextReminderDate <= hoy AND consent AND phone NOT NULL
- [ ] Enviar template vía Meta Cloud API
- [ ] Crear registro en tabla reminders (SENT o FAILED)
- [ ] Recalcular nextReminderDate = hoy + frecuencia del programa
- [ ] Log: "Enviados X recordatorios. Y fallidos."

### Paso 8 — Panel web — Pantallas core
- [ ] Next.js 14 + Tailwind + shadcn/ui en `apps/web/`
- [ ] Login
- [ ] Dashboard (pacientes activos, recordatorios enviados, tasa de respuesta)
- [ ] Pacientes (tabla con búsqueda/filtros/paginación)
- [ ] Ficha paciente (datos + programas + "marcar control" + recordatorios + conversaciones)

### Paso 9 — Panel web — Pantallas admin
- [ ] Programas (lista + editar template/centros)
- [ ] Médicos (CRUD + asignar a programas)
- [ ] Importar CSV (drag & drop + preview + validación + confirmación)
- [ ] Conversaciones (chats del bot con filtros y mensajes paginados)

### Paso 10 — Deploy + Test end-to-end
- [ ] Deploy API en Railway
- [ ] Deploy Panel en Vercel
- [ ] Configurar webhook Meta con URL de producción
- [ ] Crear templates de mensaje y enviar a aprobación de Meta
- [ ] Seed producción: 9 programas + admin
- [ ] Test: registrar por bot → ver en panel → marcar control → verificar recordatorio
