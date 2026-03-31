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

### Paso 4 — CRUD Pacientes + Deduplicación ✅
- [x] GET /patients (búsqueda nombre/DNI, filtros programa/status, paginación)
- [x] GET /patients/:id (con programas y recordatorios)
- [x] POST /patients (UPSERT por DNI)
- [x] PATCH /patients/:id
- [x] POST /patients/import (CSV upload + validación + UPSERT masivo)

### Paso 5 — Programas + Inscripciones + Control ✅
- [x] GET /programs, GET /programs/:id, PATCH /programs/:id
- [x] POST /patients/:id/programs (inscribir a programa)
- [x] POST /patient-programs/:id/control (marcar control → recalcular nextReminderDate)
- [x] PATCH /patient-programs/:id (cambiar status)
- [x] DELETE /patient-programs/:id (dar de baja)
- [x] CRUD doctors + doctor_programs (solo admin)

### Paso 6 — Webhook WhatsApp + Bot ✅
- [x] GET /webhooks/whatsapp (verificación Meta)
- [x] POST /webhooks/whatsapp (recibir mensajes)
- [x] Flujo registro: pedir nombre → pedir DNI → UPSERT → vincular teléfono
- [x] Flujo chat: buscar paciente por teléfono → modo AI con Claude
- [x] System prompt: datos paciente + programas + centros + disclaimer
- [x] "BAJA" → consent = false
- [x] Tabla conversations + messages (rows individuales)

### Paso 7 — Cron de recordatorios ✅
- [x] node-cron todos los días 8:00 AM (UTC-3)
- [x] Query: nextReminderDate <= hoy AND consent AND phone NOT NULL
- [x] Enviar template vía Meta Cloud API
- [x] Crear registro en tabla reminders (SENT o FAILED)
- [x] Recalcular nextReminderDate = hoy + frecuencia del programa
- [x] Log: "Enviados X recordatorios. Y fallidos."

### Paso 8 — Panel web — Pantallas core ✅
- [x] Next.js 14 + Tailwind + shadcn/ui en `apps/web/`
- [x] Login
- [x] Dashboard (pacientes activos, recordatorios enviados, tasa de respuesta)
- [x] Pacientes (tabla con búsqueda/filtros/paginación)
- [x] Ficha paciente (datos + programas + "marcar control" + recordatorios + conversaciones)

### Paso 9 — Panel web — Pantallas admin ✅
- [x] Programas (lista + editar template/centros)
- [x] Médicos (CRUD + asignar a programas)
- [x] Importar CSV (drag & drop + preview + validación + confirmación)
- [x] Conversaciones (chats del bot con filtros y mensajes paginados)

### Paso 10 — Deploy + Test end-to-end ✅
- [x] Deploy API en Railway (Dockerfile multi-stage + start-api.sh + CI/CD pipeline)
- [x] Deploy Panel en Vercel (next.config.js standalone + security headers)
- [ ] Configurar webhook Meta con URL de producción (requiere URL desplegada)
- [ ] Crear templates de mensaje y enviar a aprobación de Meta (requiere Meta Business Manager)
- [x] Seed producción: 9 programas + admin (seed-prod.ts con ADMIN_PASSWORD requerido)
- [ ] Test: registrar por bot → ver en panel → marcar control → verificar recordatorio (requiere deploy activo)

**Nota:** Los items sin marcar requieren URLs de producción activas y acceso a Meta Business Manager. La infraestructura de deploy (Dockerfile, CI/CD, scripts, monitoreo, SLOs) está completa.

---

### Paso 11 — Notas operativas del paciente ✅
- [x] Nueva tabla `patient_notes` (id, patientId, doctorId, content, createdAt)
- [x] API: POST /api/patients/:id/notes, GET /api/patients/:id/notes
- [x] Validación: max 500 chars, sanitizar contra CSV injection
- [x] Panel: sección "Notas" en ficha del paciente con formulario y listado
- [x] Bot: incluir últimas 3 notas operativas en el system prompt
- [x] Permisos: ADMIN ve todas, DOCTOR solo las de sus programas

### Paso 12 — Próximo control editable ✅
- [x] API: PATCH /api/patient-programs/:id/next-control con fecha manual
- [x] Validación: fecha debe ser futura, no más de 2 años
- [x] Panel: botón "Cambiar fecha" al lado de "Próximo recordatorio" en ficha paciente
- [x] El cron de recordatorios respeta la fecha manual (ya lo hace, solo cambia el valor)

### Paso 13 — Alertas y pacientes en riesgo ✅
- [x] API: GET /api/dashboard/alerts con categorías (vencido, sin respuesta, baja)
- [x] Lógica: control vencido >30 días = amarillo, >60 días = rojo
- [x] Lógica: 3+ recordatorios sin respuesta = alerta
- [x] Lógica: pacientes con consent=false (pidieron BAJA) = alerta
- [x] Panel: sección "Alertas" en Dashboard con semáforo y lista de pacientes
- [x] Permisos: DOCTOR ve solo alertas de sus programas

### Paso 14 — Exportar datos ✅
- [x] API: GET /api/patients/export?format=csv con filtros (programa, status)
- [x] Columnas: nombre, DNI, teléfono, programas, último control, próximo control, estado
- [x] Sanitización CSV injection en todos los campos exportados (LESSONS #30)
- [x] Panel: botón "Exportar CSV" en la lista de pacientes

### Paso 15 — Editar datos del paciente ✅
- [x] API: ya existe PATCH /api/patients/:id — verificar que acepta todos los campos
- [x] Panel: botón "Editar" en ficha del paciente con dialog para nombre, teléfono, birthDate, gender
- [x] Validación: DNI no editable (es la clave de deduplicación), teléfono E.164
- [x] Permisos: ADMIN y DOCTOR de los programas del paciente
