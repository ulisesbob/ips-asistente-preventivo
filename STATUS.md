# IPS — Asistente Preventivo para Pacientes Crónicos

## Estado actual
- **Estado:** PRODUCCIÓN ACTIVA — Render (API) + Vercel (Panel) + WhatsApp Bot (Twilio)
- **Último hito:** Bloque medicación (duración + instrucciones + efectos secundarios) deployado a producción
- **Compliance ley 25.326:** ACTIVO — audit log, cifrado en reposo de PII clínica, consentimiento trazable, soft-delete
- **Observabilidad:** Sentry activo en la API (sin PII)
- **Bot:** Claude Sonnet 4.6 + fallback Haiku 4.5, personalidad "Ana", 30 FAQs reales IPS, menú inicial de 3 opciones + autoinscripción a programas por chat
- **Bloqueadores:** Ninguno técnico. Pendiente de seguridad: rotar contraseña de la DB (ver Pendientes).
- **Fecha:** 21 de mayo de 2026

### URLs / accesos
- **API (Render):** https://ips-asistente-preventivo.onrender.com — health: `/health`, `/health/deep`
- **Panel (Vercel):** producción + previews por PR
- **Repo:** github.com/ulisesbob/ips-asistente-preventivo — deploy automático en push a `main`
- **DB:** Neon PostgreSQL (serverless). Backup del 2026-05-21 (pre-cifrado) en branch `br-damp-boat-amgjf82g`.

---

## Qué es

Sistema para el IPS (Instituto de Previsión Social de Misiones) con dos partes:

1. **Bot de WhatsApp con IA** — Atiende consultas de afiliados 24/7, envía recordatorios automáticos de controles y medicación, hace seguimiento de pacientes sin programa, y permite al paciente crear sus propios recordatorios desde el chat.
2. **Panel web para médicos** — Gestión de pacientes, programas, recordatorios de medicación (con duración e instrucciones), conversaciones, notas, importación CSV, alertas y exportación.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + TypeScript + Express |
| Frontend | Next.js 14 (App Router) + Tailwind + Radix UI (base shadcn) + react-hook-form |
| Base de datos | PostgreSQL (Neon serverless) + Prisma ORM |
| Cifrado en reposo | prisma-field-encryption (AES-GCM 256) sobre campos de texto clínico |
| IA | Claude Sonnet 4.6 (primario) + Haiku 4.5 (fallback) |
| WhatsApp | **Twilio (activo)**; soporta Meta Cloud API vía `MESSAGING_PROVIDER` (Meta caído operacionalmente) |
| Cron | node-cron (5 jobs activos) |
| Observabilidad | Sentry (`@sentry/node`) en la API, con scrub de PII |
| Deploy API | Render (Docker node:20-alpine, dumb-init). `prisma migrate deploy` automático al arrancar |
| Deploy Panel | Vercel (Next.js) |
| Monitoreo | UptimeRobot (ping /health) |

---

## Compliance ley 25.326 (datos de salud) — ACTIVO

| Medida | Detalle |
|--------|---------|
| **Cifrado en reposo** | `Message.content` y `PatientNote.content` cifrados con AES-GCM (prisma-field-encryption). Key `PRISMA_FIELD_ENCRYPTION_KEY` en Render. Backfill de los 550 registros existentes hecho el 2026-05-21. |
| **Audit log** | Tabla `audit_logs` — registra quién/qué/cuándo de cada escritura sensible (sin valores). |
| **Consentimiento trazable** | `consent`, `consentAt`, `consentVia` (BOT/PANEL) por paciente. |
| **Soft-delete** | Baja lógica de pacientes con reactivación por DNI (retención legal). |
| **Revocación de sesiones** | Invalidación de JWT en logout / cambio de password. |
| **Sentry sin PII** | `sendDefaultPii:false` + scrub de body/cookies/headers/query/user antes de enviar. `includeLocalVariables` desactivado a propósito. |

---

## Features

### Core (Pasos 1-10)
Monorepo, DB Prisma, API REST + Auth JWT, CRUD pacientes (UPSERT por DNI), 9 programas IPS, bot WhatsApp con registro por chat, cron de recordatorios, panel (login/dashboard/pacientes), panel admin (programas/médicos/CSV/conversaciones), deploy Docker + CI/CD.

### Avanzadas (Pasos 11-19)
Notas operativas, control editable, alertas semáforo, exportar CSV (anti-injection), editar paciente, base de conocimiento (30 FAQs reales), derivación a humano, encuestas post-control, recordatorios autogestivos del paciente.

### Menú + autoinscripción por chat (Paso 20)
Menú inicial de 3 opciones para números nuevos (1 consulta · 2 inscribirme en un programa · 3 turno-placeholder). La opción 1 permite consultar **sin registrarse** (chat anónimo con la KB del IPS, aislado y con rate-limit por número). La opción 2 lista los programas y el paciente se **autoinscribe por chat**: se crea el `PatientProgram` con `enrolledVia=BOT` y `reviewedAt=null` (activa directo, marcada para revisión del equipo en el panel). Un paciente puede sumar más de un programa. Escrituras del bot atribuidas a `actorType=BOT` en el audit log.

### Modo híbrido de atención (Paso 21)
El operador/médico puede escribirle al paciente desde el panel también en conversaciones **OPEN** (antes solo en ESCALATED). Al escribir en OPEN, el bot queda **en pausa** (`Conversation.botPausedUntil`, 30 min auto-expirable) y NO responde nada (el check va al inicio de `handleIncomingMessage`, antes de unsupported/BAJA/ALTA/encuesta/IA, así nada se cuela sobre la persona). El operador devuelve el control con **"Devolver al bot"** (`POST /conversations/:id/resume`). Acceso por programa (anti-IDOR) en reply y resume; pausa/resume auditadas. Decisión: el operador puede responder a un paciente con BAJA (atención humana en curso); los crons automáticos no se silencian (igual que con ESCALATED).

### Compliance y producción (mayo 2026)
| Feature | Descripción |
|---------|-------------|
| Cifrado en reposo PII | AES-GCM sobre mensajes y notas clínicas + backfill |
| Audit log + consentimiento | Trazabilidad ley 25.326 |
| Soft-delete pacientes | Baja lógica + reactivación por DNI |
| Anti-duplicados DNI/teléfono | `@unique` en `dni` y `phone` + normalización canónica en TODAS las vías (bot/panel/CSV): DNI a solo dígitos, teléfono a E.164 con el "9" de móvil AR (`+549...`). Mismo número/DNI en cualquier formato → mismo string → no se puede duplicar. Script `check-phone-dupes.ts` para normalizar/detectar colisiones en data vieja. |
| Seguimiento "sin programa" | Followup automático (cron) + alertas admin en el dashboard para pacientes registrados por bot que nadie inscribió |
| Observabilidad (Sentry) | Captura de errores 5xx + fallback AI Sonnet→Haiku, sin PII |
| **Medicación ampliada** | Duración del tratamiento (continuo / por X días, auto-apagado al vencer), instrucciones del médico (el bot las reenvía literal), campo de efectos secundarios (lo carga el médico; la IA nunca los genera) |

---

## Bot — Capacidades

### Hace
- Responde FAQs (coberturas, trámites, programas, urgencias), da fechas de control y centros.
- Informa medicación activa (nombre, dosis, horario) y manda recordatorios diarios **con las instrucciones del médico**.
- Seguimiento de pacientes sin programa (hasta 3 recordatorios espaciados).
- Crea recordatorios autogestivos, escala a humano, envía encuestas, registra pacientes (nombre+DNI), procesa BAJA/ALTA.
- Muestra un menú inicial a números nuevos (consulta / inscripción / turnos) y deja consultar sin registrarse.
- Permite que el paciente se **autoinscriba a programas por chat** (a su pedido), marcando la inscripción para revisión del equipo.

### NO hace (por diseño)
- NUNCA evalúa síntomas ni recomienda tratamientos.
- NUNCA genera/recita efectos secundarios — solo reenvía lo que el médico cargó.
- NUNCA revela notas internas.
- NUNCA decide clínicamente una inscripción: la autoinscripción por chat es **a pedido del paciente** y queda marcada (`enrolledVia=BOT`, `reviewedAt=null`) para que un profesional la revise — la IA no la valida ni la genera por su cuenta.

---

## Crons activos (5)

| Cron | Frecuencia | Qué hace |
|------|-----------|----------|
| Recordatorios de controles | Diario 8:00 AM AR | WA a pacientes con control vencido |
| Recordatorios de medicación | Cada 30 min | WA según hora; incluye instrucciones; auto-apaga tratamientos vencidos |
| Encuestas post-control | Diario 10:00 AM AR | Encuesta 24h después del control |
| Recordatorios autogestivos | Cada 30 min | Recordatorios puntuales creados por el paciente |
| Followup sin programa | Diario 10:30 AM AR | Hasta 3 avisos a pacientes registrados por bot sin programa |

---

## Base de datos — 13 tablas

doctors, doctor_programs, patients, programs, patient_programs, reminders, conversations, messages, patient_notes (cifrada), knowledge_base, surveys, medication_reminders (+ endDate/instructions/sideEffects), patient_self_reminders, **audit_logs**.
> `messages.content` y `patient_notes.content` cifrados en reposo.

---

## Seguridad

- JWT httpOnly (access 15min + refresh 7d) con revocación; bcrypt; CORS restringido; Helmet; Zod en todos los endpoints.
- HMAC verificación de webhooks; dedup de webhooks; rate limiting; verificación timing-safe.
- Defensa anti prompt-injection (strip `<>`, notas con doble barrera).
- Cifrado en reposo de PII clínica + audit log (ver sección Compliance).
- Sin datos clínicos detallados: solo nombre, DNI, teléfono, programa, fechas, medicación.

---

## Testing

- **422 tests** unitarios (20 archivos), todo verde. Incluye filtro de PII de Sentry y duración/auto-apagado de medicación.
- CI en GitHub Actions: build db + api + web + tests en cada PR a `main`.

---

## Roadmap clínico (pedido por un médico, 2026-05-21)

Research hecho: el grueso se construye sobre el stack actual (no hacen falta frameworks). Estado:

| # | Pedido | Estado |
|---|--------|--------|
| 1 | Medicación con duración + instrucciones | ✅ **Hecho** (este deploy) |
| 4 | Recordatorios contextuales (ej. comer antes de insulina) | ✅ Cubierto por el campo "instrucciones" |
| 2 | Turnos con recordatorios escalonados (1 sem / 2 días) | ⬜ Próximo bloque (tabla + node-cron) |
| 7 | Bot de turnos por WhatsApp | ⬜ Próximo bloque (Claude tool use) |
| 8 | Pantalla de carga del médico (indicaciones/turnos) | 🔶 Parcial (medicación lista; turnos pendiente) |
| 3 | Efectos secundarios | 🔴 Campo listo; **bloqueado**: no hay fuente abierta argentina válida → los carga/valida el médico, el bot los reenvía |
| 9 | Receta electrónica | 🔴 **Bloqueado (legal)**: Ley 27.553 — solo válida vía plataforma registrada en ReNaPDiS (ej. Integrando Salud/FHIR). Decisión institucional antes de integrar |

---

## Pendientes

1. 🔑 **Rotar contraseña de la DB (Neon)** — la connection string quedó expuesta el 2026-05-21. Rotar + actualizar `DATABASE_URL` en Render (en bajo tráfico, para no cortar el bot).
2. ✏️ **Editar medicación** ya cargada en el panel (hoy: crear/pausar/borrar; editar = borrar y recrear).
3. 📊 **Sentry en el panel** (`@sentry/nextjs`) — hoy solo está en la API.
4. 🧹 *Drift* preexistente de `patient_self_reminders` en el schema (no afecta funcionamiento).
5. **Meta**: verificación de negocio + templates aprobados (operación actual por Twilio).
6. **Render Starter** ($7/mes) si el free tier sigue durmiendo el container.

---

## Infra y deploy

```
Render (1 servicio)
  Express (Node + TS)
  ├── API REST (panel)        ├── Webhook WhatsApp (Twilio)
  ├── AI (Sonnet 4.6 + Haiku) ├── Sentry (errores, sin PII)
  ├── 5 crons                 └── migrate deploy automático al arrancar
  PostgreSQL (Neon) + Prisma (+ cifrado de campos)

Vercel
  Next.js 14 — Panel de médicos (deploy en push a main + previews por PR)
```

---

## Historial

| Fecha | Qué se hizo |
|-------|-------------|
| 2026-03-30/31 | Pasos 0-18: spec, monorepo, DB, API, bot, crons, panel, deploy, notas, alertas, CSV, KB, derivación, encuestas. Reviews + 140 tests |
| 2026-04-10 | Paso 19: recordatorios autogestivos. 267 tests. Reviews multi-agente |
| 2026-05-19 | Compliance ley 25.326: audit log, consentimiento, soft-delete, cifrado en reposo de PII + hardening. Followup "sin programa" + alertas |
| 2026-05-20 | Observabilidad con Sentry en la API (sin PII) + test del filtro de PII + flush en shutdown |
| 2026-05-21 | Deploy a producción del compliance + Sentry + alertas (PR #1). Cifrado activado en prod + backfill de 550 registros. Bloque medicación: duración + instrucciones + efectos secundarios, con TDD + code-review (PR #2). 422 tests |
