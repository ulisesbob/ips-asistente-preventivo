# Estado del Proyecto

## Estado actual
- **Último paso completado:** Paso 18 — Encuestas post-control + Recordatorios de medicación
- **Paso actual:** TODOS LOS PASOS COMPLETADOS (1-18) + features extras
- **Bloqueadores:** Ninguno
- **Deploy:** Producción activa en Render (API) + Vercel (Panel)
- **Bot:** Sonnet 4.6, personalidad "Ana", base de conocimiento con datos reales del IPS

## Features implementadas
| # | Feature | Estado |
|---|---------|--------|
| 1 | Monorepo + config base | ✅ |
| 2 | Prisma schema + DB (11 tablas) | ✅ |
| 3 | API Express + Auth JWT | ✅ |
| 4 | CRUD Pacientes + Deduplicación DNI | ✅ |
| 5 | Programas + Inscripciones + Control | ✅ |
| 6 | Webhook WhatsApp + Bot AI | ✅ |
| 7 | Cron recordatorios (8AM Argentina) | ✅ |
| 8 | Panel web — Pantallas core | ✅ |
| 9 | Panel web — Pantallas admin | ✅ |
| 10 | Deploy Render + Vercel + WhatsApp | ✅ |
| 11 | Notas operativas del paciente | ✅ |
| 12 | Próximo control editable | ✅ |
| 13 | Alertas y pacientes en riesgo | ✅ |
| 14 | Exportar datos CSV | ✅ |
| 15 | Editar datos del paciente | ✅ |
| 16 | Base de conocimiento (30 FAQs reales IPS) | ✅ |
| 17 | Derivación a humano (escalamiento) | ✅ |
| 18 | Encuestas post-control | ✅ |
| — | Recordatorios de medicación diarios | ✅ |
| — | Bot upgrade a Sonnet 4.6 + personalidad "Ana" | ✅ |
| — | KB con datos reales de ipsmisiones.com.ar | ✅ |

## Bot — Capacidades
- Responde preguntas de coberturas, trámites, programas, urgencias (30 FAQs)
- Da fechas exactas de próximo control y centros de atención
- Sabe que envía recordatorios automáticos (controles + medicación)
- Escala a humano cuando el paciente lo pide
- Hace encuestas de satisfacción post-control
- Tono: "Ana", secretaria amable del IPS, español argentino
- Modelo: Claude Sonnet 4.6
- 0800 solo como último recurso

## Crons activos
| Cron | Frecuencia | Qué hace |
|------|-----------|----------|
| Recordatorios de controles | Diario 8:00 AM Argentina | Envía WA a pacientes con nextReminderDate vencida |
| Recordatorios de medicación | Cada 30 min | Envía WA según hora configurada por médico |
| Encuestas post-control | Diario 10:00 AM Argentina | Envía encuesta WA 24h después de control marcado |

## Infra
- API: Render (Docker, node:20-alpine, dumb-init)
- Panel: Vercel (Next.js 14 standalone)
- DB: PostgreSQL (Railway/Neon)
- WhatsApp: Meta Cloud API
- AI: Anthropic Claude Sonnet 4.6
- Monitoreo: UptimeRobot (recomendado) + structured JSON logs

## Seguridad — Auditorías completadas
- 5 code reviews con agentes especializados
- 2 security audits completos
- Todos los CRITICAL y HIGH resueltos
- react-doctor: 97/100 (0 errores)
- 44 lecciones documentadas en LESSONS.md

## Historial
| Fecha | Paso | Qué se hizo |
|-------|------|-------------|
| 2026-03-30 | 0 | Spec, mapa visual, plan, CLAUDE.md, LESSONS.md, STATUS.md creados |
| 2026-03-30 | 1 | Monorepo: git init, workspaces, tsconfig base, .env.example. Code review passed. |
| 2026-03-30 | 2 | Prisma schema: 8 tablas, 7 enums, 28 indexes. Seed: 9 programas + admin + doctores + pacientes. Code review passed. |
| 2026-03-30 | 3 | API Express + Auth JWT (access 15min + refresh 7d). Zod validation. Security audit passed. |
| 2026-03-30 | 4 | CRUD Pacientes + Deduplicación DNI. CSV import. Code review + security audit passed. |
| 2026-03-30 | 5 | Programas + Inscripciones + Control + Doctors. 11 endpoints. Security audit passed. |
| 2026-03-30 | 6 | Webhook WhatsApp + Bot AI. Flujo registro + chat + BAJA/ALTA. HMAC-SHA256. Code review + security audit passed. |
| 2026-03-30 | 7 | Cron recordatorios 8AM Argentina. Concurrency guard, rate limit. Security audit passed. |
| 2026-03-30 | 8 | Panel web core: Login, Dashboard, Pacientes, Ficha, Programas. react-doctor 100/100. |
| 2026-03-30 | 9 | Panel admin: Médicos CRUD, Importar CSV, Conversaciones. react-doctor 96/100. |
| 2026-03-30 | 10 | Deploy: Dockerfile multi-stage, CI/CD, health endpoints, SLOs. Docker audit passed. |
| 2026-03-30 | 10+ | Deploy producción Render + Vercel. Bugs de números argentinos + redirect loop arreglados. E2E verificado. |
| 2026-03-31 | 11 | Notas operativas: tabla + API + panel + bot context. Security audit: prompt injection defense, VarChar DB, rate limit. |
| 2026-03-31 | 12 | Próximo control editable: PATCH next-control + date picker UI. UTC getters fix (LESSONS #44). |
| 2026-03-31 | 13 | Alertas dashboard: 4 categorías con semáforo. Split queries overdue. noResponse con ventana 90 días. |
| 2026-03-31 | 14 | Exportar CSV: sanitización (LESSONS #30), BOM Excel, role-based, auth token refresh. |
| 2026-03-31 | 15 | Editar paciente: dialog con validación, phone nullable, DNI no editable. |
| 2026-03-31 | 16 | Base de conocimiento: tabla knowledge_base, 30 FAQs reales IPS (coberturas, programas, delegaciones), CRUD panel, bot keyword matching. |
| 2026-03-31 | 17 | Derivación a humano: enum ESCALATED, detección keywords, bot silencioso durante escalación, panel reply + close, WA desde panel. |
| 2026-03-31 | 18 | Encuestas post-control: tabla surveys con dispatchedAt, cron diario 10AM, bot parsea Sí/No + rating 1-5, dashboard satisfacción con bar chart. |
| 2026-03-31 | — | Recordatorios medicación: tabla medication_reminders, CRUD panel en ficha paciente, cron cada 30min con Intl timezone, WA diario. |
| 2026-03-31 | — | Bot upgrade: Haiku→Sonnet 4.6, personalidad "Ana", system prompt humanizado, 0800 como último recurso. |
| 2026-03-31 | — | KB datos reales: 30 FAQs verificadas de ipsmisiones.com.ar (coberturas, programas, delegaciones, trámites, urgencias). |
| 2026-03-31 | — | Review completo: 3 code reviews + 2 security audits. Fixed: access control meds, ESCALATED guards, phone normalization, survey dispatch, timezone, debounce. react-doctor 97/100. |
