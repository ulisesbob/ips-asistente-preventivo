# Estado del Proyecto

## Estado actual
- **Último paso completado:** Paso 19 — Recordatorios autogestivos del paciente
- **Estado:** PRODUCCIÓN ACTIVA — Render (API) + Vercel (Panel) + WhatsApp Bot
- **Bot:** Sonnet 4.6 con retry + fallback Haiku, personalidad "Ana", 30 FAQs reales IPS
- **UptimeRobot:** Configurado — ping cada 5 min a /health
- **Bloqueadores:** Ninguno activo (requiere deploy para activar migración)

## Features implementadas (25 en total)

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
| 19 | Recordatorios autogestivos del paciente | ✅ |
| — | Recordatorios de medicación diarios | ✅ |
| — | Bot Sonnet 4.6 + personalidad "Ana" | ✅ |
| — | KB con datos reales de ipsmisiones.com.ar | ✅ |
| — | Deduplicación de webhooks Meta | ✅ |
| — | Retry Sonnet 2x + fallback Haiku | ✅ |
| — | Inscripción a programas → derivación presencial | ✅ |
| — | Recordatorios autogestivos via bot (lenguaje natural) | ✅ |

## Bot — Capacidades actuales
- Responde preguntas de coberturas, trámites, programas, urgencias (30 FAQs reales)
- Da fechas exactas de próximo control y centros de atención
- Informa medicación activa del paciente (nombre, dosis, horario)
- Sabe que envía recordatorios automáticos (controles + medicación)
- Escala a humano cuando el paciente lo pide
- Hace encuestas de satisfacción post-control
- Explica cómo inscribirse presencialmente en programas
- Retry Sonnet 2x + fallback a Haiku si Anthropic está saturado
- Deduplicación de webhooks (no responde 30 veces al mismo mensaje)
- Tono: "Ana", secretaria amable del IPS, español argentino
- Modelo primario: Claude Sonnet 4.6 / Fallback: Claude Haiku 4.5
- 0800 solo como último recurso

## Crons activos
| Cron | Frecuencia | Qué hace |
|------|-----------|----------|
| Recordatorios de controles | Diario 8:00 AM Argentina | Envía WA a pacientes con nextReminderDate vencida |
| Recordatorios de medicación | Cada 30 min | Envía WA según hora configurada por médico |
| Encuestas post-control | Diario 10:00 AM Argentina | Envía encuesta WA 24h después de control marcado |
| Recordatorios autogestivos | Cada 30 min | Envía recordatorios creados por pacientes vía bot |

## Infra
- API: Render (Docker, node:20-alpine, dumb-init) + UptimeRobot keep-alive
- Panel: Vercel (Next.js 14 standalone)
- DB: PostgreSQL (Neon — ep-billowing-cherry)
- WhatsApp: Meta Cloud API (token temporal, pendiente migrar a permanente)
- AI: Anthropic Claude Sonnet 4.6 + Haiku 4.5 fallback
- Monitoreo: UptimeRobot (ping /health cada 5 min)

## Testing
- **179 tests unitarios**, 10 archivos, todo verde
- Cobertura: auth, middleware, phone normalization, CSV sanitization, escalation detection, survey parsing, medication slots, KB keywords

## Seguridad — Auditorías completadas
- 5 code reviews con agentes especializados
- 2 security audits completos
- 1 análisis profundo de frontend (11 bugs encontrados y resueltos)
- 1 análisis profundo de backend (12 bugs encontrados y resueltos)
- react-doctor: 97/100 (0 errores)
- 52 lecciones documentadas en LESSONS.md
- Code review Paso 19: 3 HIGH + 1 MEDIUM corregidos

## Pendientes para próxima sesión
1. ~~**Token permanente de WhatsApp**~~ — ✅ Configurado en Render (2026-04-05)
2. **Verificación de negocio en Meta** — Para enviar a cualquier número sin lista blanca
3. **Templates de mensaje aprobados** — Para recordatorios proactivos
4. **Render Starter ($7/mes)** — Si el free tier sigue matando el container

## Historial
| Fecha | Qué se hizo |
|-------|-------------|
| 2026-03-30 | Pasos 0-10: Spec, monorepo, DB, API, bot, crons, panel, deploy producción |
| 2026-03-31 | Pasos 11-15: Notas, control editable, alertas, exportar CSV, editar paciente |
| 2026-03-31 | Pasos 16-18: Base de conocimiento (30 FAQs reales IPS), derivación a humano, encuestas post-control |
| 2026-03-31 | Extras: Recordatorios de medicación, bot Sonnet 4.6 + personalidad "Ana", KB datos reales ipsmisiones.com.ar |
| 2026-03-31 | Bug fixes: Deduplicación webhooks Meta, retry Sonnet + fallback Haiku, phone normalization, ESCALATED guards, survey dispatchedAt, birthDate UTC |
| 2026-03-31 | Reviews: 5 code reviews, 2 security audits, 2 deep bug hunts (frontend + backend), 140 tests |
| 2026-03-31 | Infra: UptimeRobot configurado, escalabilidad 500 pacientes simultáneos, PDF presentación generado |
| 2026-04-10 | Paso 19: Recordatorios autogestivos del paciente (bot crea/lista/cancela via lenguaje natural, cron cada 30 min, 18 tests, code review 4 fixes) |
