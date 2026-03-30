# IPS — Asistente Preventivo para Pacientes Crónicos

## REGLA #1 — OBLIGATORIA
Cuando el usuario pasa un prompt con secciones de HERRAMIENTAS (Skills, Agents, MCPs, Tools, Hooks), usar TODAS las herramientas listadas. Sin excepción. No saltear ninguna. Si el prompt dice "usa Context7", se usa Context7. Si dice "lanza code-reviewer agent", se lanza. Cada herramienta está ahí por una razón.

## REGLA #2 — CLAUDE.md ES LEY
Antes de cualquier acción, releer las reglas de este archivo. Si hay conflicto entre un prompt y este archivo, este archivo gana.

## REGLA #3 — APRENDER DE ERRORES
Leer `LESSONS.md` antes de cada tarea. No repetir errores documentados. Cuando cometas un error nuevo, documentarlo inmediatamente en LESSONS.md con el mismo formato: Error, Lección.

## REGLA #4 — CODE REVIEW AL TERMINAR CADA PASO
Al completar cada paso del plan.md, ANTES de marcarlo como completado, lanzar code-reviewer agent para revisar TODO el código del paso. Si el reviewer encuentra problemas, arreglarlos antes de avanzar al siguiente paso. Actualizar STATUS.md después del review.

## REGLA #5 — MARCAR PASOS COMPLETADOS EN plan.md
Al terminar cada paso, marcar TODOS los checkboxes del paso como `[x]` y agregar ✅ al título del paso en `plan.md`. Esto es OBLIGATORIO, no opcional. También actualizar `STATUS.md`.

## Spec
`spec.md` es la fuente de verdad del diseño. Leerla antes de cualquier cambio estructural.

## Stack
- Backend: Node.js + TypeScript + Express (apps/api/)
- Frontend: Next.js 14 + Tailwind + shadcn/ui (apps/web/)
- DB: PostgreSQL + Prisma (packages/db/)
- Cron: node-cron — SIN Redis, SIN BullMQ
- AI: Claude API (Anthropic SDK)
- WhatsApp: Meta Cloud API
- Deploy: Railway (API + DB) + Vercel (Panel)

## Datos de salud — NUNCA
- NUNCA almacenar diagnósticos, resultados, tratamientos, ni texto libre médico
- Solo: nombre, DNI, teléfono, programa, fechas de control
- NO existe tabla medical_notes — eliminada por diseño
- El médico solo puede "marcar control realizado" (una fecha)

## Bot — reglas
- NUNCA evaluar síntomas ni recomendar tratamientos
- Solo recordatorios + info de coberturas/centros
- Disclaimer obligatorio: "Esta información es orientativa. Comuníquese al 0800-888-0109"
- "BAJA" → consent = false, dejar de enviar recordatorios

## Deduplicación
- DNI es UNIQUE key en patients
- Panel, CSV e bot → UPSERT por DNI
- Si existe → actualizar campos faltantes (vincular teléfono)
- Si no existe → crear nuevo
- NUNCA duplicar pacientes

## DB
- Messages como rows en tabla `messages`, NUNCA JSON[]
- Relaciones many-to-many con tablas intermedias, NUNCA arrays UUID
- 9 programas oficiales del IPS (no inventar)

## Código
- TypeScript strict: true
- Prisma para TODO acceso a DB
- Zod en todos los endpoints
- JWT + bcrypt + CORS solo dominio del panel

## Roles
- ADMIN: ve todo, gestiona médicos, importa CSV, edita programas
- DOCTOR: ve solo pacientes de sus programas (via doctor_programs)

## Programas del IPS (9)
1. Diabetes (3 meses)
2. Mujer Sana (12 meses)
3. Hombre Sano (12 meses)
4. PREDHICAR / Hipertensión (1 mes)
5. Osteoporosis (12 meses)
6. Oncológico (3/6/12 meses configurable)
7. Celíacos (12 meses)
8. Cáncer de Colon (12 meses)
9. Plan Materno Infantil (según gestación)
