# IPS — Asistente Preventivo para Pacientes Crónicos

Sistema del **Instituto de Previsión Social de Misiones** para atender afiliados crónicos vía WhatsApp y gestionarlos desde un panel web.

- **Bot de WhatsApp con IA** — Responde consultas 24/7, envía recordatorios automáticos de controles y medicación, escala a humano cuando hace falta.
- **Panel web para médicos** — CRUD de pacientes, programas, recordatorios, conversaciones, alertas y exportación.

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Node.js + TypeScript + Express |
| Frontend | Next.js 14 + Tailwind + shadcn/ui |
| DB | PostgreSQL (Neon) + Prisma |
| IA | Claude Sonnet 4.6 + Haiku 4.5 (fallback) |
| WhatsApp | Meta Cloud API (default) o Twilio (alternativa) |
| Deploy | Render (API) + Vercel (panel) |

## Estructura

```
apps/
  api/      → Backend Express (webhook, AI, crons, REST)
  web/      → Panel Next.js para médicos
packages/
  db/       → Prisma schema + seeds compartidos
scripts/    → Scripts utilitarios
```

## Arrancar local

```bash
# 1. Variables de entorno
cp .env.example .env
# Editar .env con DATABASE_URL, JWT_SECRET, etc.

# 2. Instalar y migrar
npm install
npm run db:generate
npm run db:migrate
npm run db:seed

# 3. Levantar API y panel
npm run dev:api    # http://localhost:3001
npm run dev:web    # http://localhost:3000
```

## Documentación

| Archivo | Para qué |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | Reglas obligatorias del proyecto (leer primero) |
| [`STATUS.md`](./STATUS.md) | Estado actual: features, endpoints, infra |
| [`spec.md`](./spec.md) | Diseño: DB, endpoints, flujos, roles |
| [`plan.md`](./plan.md) | Plan de implementación con checklist (19 pasos) |
| [`LESSONS.md`](./LESSONS.md) | Errores resueltos y lecciones aprendidas |
| [`DEPLOY.md`](./DEPLOY.md) | Cómo desplegar en Render + Vercel |
| [`SLO.md`](./SLO.md) | Objetivos de servicio y monitoreo |
| [`escala-100k/`](./escala-100k/) | Plan para escalar a 100K pacientes |

## Reglas no negociables

- **Sin datos clínicos** — Solo nombre, DNI, teléfono, programa, fechas. Nunca diagnósticos ni tratamientos.
- **Disclaimer obligatorio** — Toda respuesta del bot termina con: *"Esta información es orientativa. Comuníquese al 0800-888-0109."*
- **Deduplicación por DNI** — UPSERT en panel, CSV y bot.
- **El bot nunca evalúa síntomas** ni recomienda tratamientos.
