# Qué Prompt Usar en Cada Paso

Referencia rápida: para cada paso del plan, qué prompt de `Prompts Clave/` copiar y pegar.

---

## Paso 1 — Monorepo + config base
**Prompt:** Ninguno especial. Es solo crear carpetas, package.json, tsconfig.
**Si hay problemas:** `01-ARREGLAR-BUG-RAPIDO.md`

---

## Paso 2 — Prisma schema + DB
**Prompt principal:** `15-DATABASE.md`
- Schema design, migraciones, seed
- Usa database-architect para diseñar las 8 tablas
- Usa Context7 para docs de Prisma actualizadas

**Si el seed falla:** `01-ARREGLAR-BUG-RAPIDO.md`

---

## Paso 3 — API Express + Auth
**Prompt principal:** `05-FEATURE-BACKEND.md`
- Crear Express, rutas, middleware, JWT, bcrypt
- Usa backend-dev agent para la estructura
- Usa Context7 para docs de Express/JWT

**Para los tests de auth:** `09-TESTING-TDD.md`

---

## Paso 4 — CRUD Pacientes + Deduplicación
**Prompt principal:** `05-FEATURE-BACKEND.md`
- Endpoints REST, UPSERT por DNI, paginación
- Usa backend-dev + database-architect

**Para import CSV:** `05-FEATURE-BACKEND.md` (es una feature backend pura)

**Si el UPSERT tiene bugs:** `01-ARREGLAR-BUG-RAPIDO.md`

---

## Paso 5 — Programas + Inscripciones + Control
**Prompt principal:** `05-FEATURE-BACKEND.md`
- CRUD programas, inscripciones, marcar control
- Lógica de recalcular nextReminderDate

**Si hay bugs en las relaciones many-to-many:** `15-DATABASE.md`

---

## Paso 6 — Webhook WhatsApp + Bot
**Prompt principal:** `03-FEATURE-FULLSTACK.md`
- Es fullstack: webhook (backend) + AI (Claude API) + flujo de registro
- Usa backend-dev para el webhook
- Usa ai-engineer para la integración con Claude

**Para el flujo de AI/prompts:** `13-AI-PROMPTS-AGENTES.md`
- System prompt del bot, manejo de contexto, Claude API

**Para testear el bot en browser:** `09-TESTING-TDD.md`
- Usa Playwright para simular conversaciones

**Si el webhook no funciona:** `02-BUG-COMPLEJO-PRODUCCION.md`
- Bugs de webhook son difíciles, necesitás el prompt pesado

---

## Paso 7 — Cron de recordatorios
**Prompt principal:** `05-FEATURE-BACKEND.md`
- Es backend puro: cron + query + enviar mensaje + actualizar DB

**Si los mensajes no se envían:** `02-BUG-COMPLEJO-PRODUCCION.md`
- Problemas con Meta Cloud API necesitan debugging completo

**Para verificar que funciona:** `09-TESTING-TDD.md`

---

## Paso 8 — Panel web — Pantallas core
**Prompt principal:** `04-FEATURE-FRONTEND.md`
- Login, Dashboard, Pacientes, Ficha paciente
- Usa frontend-dev, ui-designer, shadcn-ui
- Usa Pencil MCP para diseño visual
- Usa Playwright para testear

**Para el dashboard con gráficos:** `04-FEATURE-FRONTEND.md`

**Si algo se ve mal:** `01-ARREGLAR-BUG-RAPIDO.md`

---

## Paso 9 — Panel web — Pantallas admin
**Prompt principal:** `04-FEATURE-FRONTEND.md`
- Programas, Médicos, Importar CSV, Conversaciones

**Para el import CSV (drag & drop + preview):** `03-FEATURE-FULLSTACK.md`
- Es fullstack: frontend (UI upload) + backend (parsing + validación)

---

## Paso 10 — Deploy + Test end-to-end
**Prompt principal:** `11-DEPLOY-DEVOPS.md`
- Deploy Railway + Vercel
- Configurar webhook Meta producción

**Para testear todo end-to-end:** `09-TESTING-TDD.md`

**Para seguridad antes de producción:** `10-SEGURIDAD.md`
- Scan de vulnerabilidades, hardening, CORS, HTTPS

**Para review final del código:** `06-REVIEW-COMPLETO.md`
- Code review completo antes de entregar

---

## RESUMEN RÁPIDO

| Paso | Prompt principal | Prompt secundario |
|------|-----------------|-------------------|
| 1 | — (simple) | 01 si hay bugs |
| 2 | **15-DATABASE** | 01 si falla seed |
| 3 | **05-BACKEND** | 09-TESTING |
| 4 | **05-BACKEND** | 15-DATABASE si bugs en UPSERT |
| 5 | **05-BACKEND** | 15-DATABASE si bugs en relaciones |
| 6 | **03-FULLSTACK** + **13-AI-AGENTES** | 02-BUG-COMPLEJO si webhook falla |
| 7 | **05-BACKEND** | 02-BUG-COMPLEJO si Meta API falla |
| 8 | **04-FRONTEND** | 01 si bugs UI |
| 9 | **04-FRONTEND** + **03-FULLSTACK** (CSV) | 01 si bugs UI |
| 10 | **11-DEPLOY** + **10-SEGURIDAD** + **06-REVIEW** | 09-TESTING para E2E |

## COMBOS PARA MOMENTOS CLAVE

**Antes de mostrar la demo a Benmaor:**
1. `06-REVIEW-COMPLETO.md` — review de todo el código
2. `10-SEGURIDAD.md` — scan de seguridad
3. `16-PERFORMANCE.md` — optimizar velocidad
4. `09-TESTING-TDD.md` — tests E2E

**Si algo se rompe en producción:**
1. `02-BUG-COMPLEJO-PRODUCCION.md` — debugging pesado
2. `11-DEPLOY-DEVOPS.md` — si es problema de deploy

**Para la propuesta comercial al IPS:**
1. `14-DOCUMENTOS.md` — armar el PDF/PPTX de la propuesta
2. `12-MARKETING-COMPLETO.md` — copy del email a Benmaor
