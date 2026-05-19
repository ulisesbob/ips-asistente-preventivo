# Paso E1 — Crons fuera del proceso

**Tipo**: Código backend
**Tiempo estimado**: 3-4 días
**Skills**: nodejs-backend-patterns, test-driven-development, vitest, verification-before-completion
**Agents**: backend-developer, test-architect, code-reviewer
**MCPs**: Context7 (Render Cron Jobs, Postgres advisory locks)

---

## Prompt para copiar y pegar

```
Vamos a ejecutar el Paso E1 del plan de escala: mover los 4 crons fuera del proceso para que no se dupliquen con múltiples instancias.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Lectura previa (obligatoria)

1. CLAUDE.md completo (las 6 reglas son LEY)
2. LESSONS.md (no repetir errores, especialmente sobre node-cron, timezones, Docker)
3. escala-100k/PLAN.md sección "Paso E1"
4. STATUS.md sección "Crons activos" para entender qué hace cada uno
5. apps/api/src/crons/ — leer el código actual de los 4 crons

## Investigación con Context7

Antes de elegir solución, buscar docs actualizadas de:
- Render Cron Jobs (jobs separados del web service, cómo se configuran)
- Postgres advisory locks (pg_try_advisory_lock vs pg_advisory_lock, performance, pitfalls)
- node-cron limitaciones documentadas

## Decisión arquitectónica (registrar en LESSONS.md)

Comparar las 2 opciones del plan:
- Opción A: Render Cron Jobs nativo
- Opción B: Leader election con Postgres advisory locks

Decidir según: costo extra, complejidad, observabilidad, recovery en caso de falla. Documentar la decisión y por qué en LESSONS.md.

## Implementación TDD (test-driven-development skill)

Para cada uno de los 4 crons:
1. Escribir test que falle: simular 3 procesos compitiendo, esperar que solo 1 ejecute
2. Implementar el mínimo para que pase
3. Refactor

Crons a migrar (en este orden):
1. Recordatorios de medicación (cada 30 min) — alta frecuencia, mejor empezar acá
2. Recordatorios autogestivos (cada 30 min)
3. Encuestas post-control (10 AM)
4. Recordatorios de controles (8 AM) — el más crítico, último

## Sub-tareas (usar TodoWrite)

- [ ] Decidir Opción A o B y documentar
- [ ] Implementar el mecanismo elegido (módulo compartido)
- [ ] Migrar cron de medicación + tests
- [ ] Migrar cron de autogestivos + tests
- [ ] Migrar cron de encuestas + tests
- [ ] Migrar cron de controles + tests
- [ ] Endpoint /health/cron reporta última ejecución de cada cron
- [ ] Logging: qué instancia ejecutó cada cron
- [ ] Test de integración con 3 réplicas (docker-compose)
- [ ] Verification-before-completion skill ANTES de claim "listo"

## Reglas

- TDD estricto: test primero, código después
- NO tocar la lógica de negocio de los crons (solo el disparador)
- NO sumar dependencias innecesarias
- Si Opción B (advisory locks): timeout y release siempre, nunca dejar lock colgado

## Code review (REGLA #4)

Al terminar, lanzar EN PARALELO:
- code-reviewer agent
- backend-developer agent (segunda opinión)
- test-architect agent (review de tests)

Arreglar TODO finding antes de marcar el paso como ✅.

## Cierre del paso

- Marcar checkboxes [x] en escala-100k/PLAN.md
- Agregar ✅ al título del paso
- Actualizar STATUS.md
- Documentar lecciones en LESSONS.md
- Commit: "feat(scale): Paso E1 — crons fuera del proceso con [opción elegida]"
```
