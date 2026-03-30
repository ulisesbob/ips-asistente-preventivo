# Estado del Proyecto

## Estado actual
- **Último paso completado:** Paso 5 — Programas + Inscripciones + Control
- **Paso actual:** Listo para Paso 6 — Webhook WhatsApp + Bot
- **Bloqueadores:** Ninguno
- **Próxima acción:** Paso 6 — Webhook WhatsApp + Bot

## Historial
| Fecha | Paso | Qué se hizo |
|-------|------|-------------|
| 2026-03-30 | 0 | Spec, mapa visual, plan, CLAUDE.md, LESSONS.md, STATUS.md creados |
| 2026-03-30 | 1 | Monorepo: git init, workspaces (apps/api, apps/web, packages/db), tsconfig base, .env.example, placeholders. Code review passed. |
| 2026-03-30 | 2 | Prisma schema: 8 tablas, 7 enums, 28 indexes (optimizados por db-optimizer), 9 FKs. PostgreSQL via Docker (postgres:16-alpine). 2 migraciones (init + optimize_indexes). Seed: 9 programas IPS + 1 admin + 5 doctores + 50 pacientes + 75 inscripciones. Code review passed. |
| 2026-03-30 | 3 | API Express base + Auth: 10 archivos, layered architecture (routes→services→Prisma). Auth JWT (access 15min + refresh 7d httpOnly cookie). Endpoints: login, refresh, me. Zod validation. Security audit: token type discrimination, HS256 algorithm lock, timing-attack dummy hash, cross-origin cookie config. Code review + security audit passed. |
| 2026-03-30 | 4 | CRUD Pacientes + Deduplicación: 2 archivos nuevos (patient.service.ts 460 líneas, patient.routes.ts 167 líneas). 5 endpoints: GET / (búsqueda, filtros, paginación, role-based), GET /:id (con programas+reminders filtrados por role), POST / (UPSERT por DNI), PATCH /:id, POST /import (CSV all-or-nothing con $transaction). Security fixes: ValidationError en CSV, MAX_CSV_ROWS=5000, dedup DNI+phone interno, DOCTOR data visibility filtering. Code review + security audit passed. |
| 2026-03-30 | 5 | Programas + Inscripciones + Control + Doctors: 4 archivos nuevos (program.service.ts, program.routes.ts, doctor.service.ts, doctor.routes.ts). 11 endpoints: GET/GET/:id/PATCH programs (role-based), POST enroll patient, POST mark control (recalcula nextReminderDate), PATCH status, DELETE patient-program, GET/POST/PATCH doctors, POST/DELETE doctor-programs. Security audit: self-demotion protection, P2002 race condition handling, select clauses, null-safety. Code review + security audit passed. |
