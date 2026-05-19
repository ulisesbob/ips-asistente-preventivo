# Paso E7 — Ajustes post load-test

**Tipo**: Debugging + fixes
**Tiempo estimado**: 1 semana
**Skills**: systematic-debugging, verification-before-completion
**Agents**: error-detective, debugger, refactoring-specialist, performance-engineer, code-reviewer, security-auditor

---

## Prompt para copiar y pegar

```
Vamos a ejecutar el Paso E7: ajustes post load-test hasta cumplir criterios de éxito final.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Lectura previa

1. CLAUDE.md
2. LESSONS.md (todas las lecciones de E1-E6)
3. escala-100k/PLAN.md secciones "Paso E7" y "Criterios de éxito final"
4. escala-100k/results/load-test-results-E6.md (el output de E6)

## Activar systematic-debugging skill

Para cada problema encontrado en E6, NO parchar hasta entender el root cause.

## Tareas

### 1. Triage

Categorizar cada finding de E6:
- 🔴 Bloqueante: rompe un criterio de éxito final
- 🟡 Mejorable: degrada experiencia pero no bloquea
- 🟢 Cosmético: dejar para después

Generar escala-100k/results/fix-list-E7.md con priorización.

### 2. Arreglar bloqueantes (uno por uno, TDD)

Por cada bloqueante:
- Lanzar error-detective agent para root cause analysis
- Escribir test que reproduzca el problema
- Implementar fix mínimo
- Verificar que el test pasa
- Re-correr el escenario E6 que falló
- Documentar la lección en LESSONS.md

### 3. Re-correr load test

Después de TODOS los fixes bloqueantes, re-ejecutar el escenario combinado E6-5 completo.

### 4. Verificar los 5 criterios de éxito final

Del escala-100k/PLAN.md:
- [ ] Load test 100K pasa sin pérdida ni duplicados
- [ ] Cron 8 AM con 5.000 recordatorios en < 30 min
- [ ] 3 instancias en paralelo, ningún paciente recibe duplicado
- [ ] Rate limit Meta respetado globalmente
- [ ] Verificación negocio Meta + 5 templates aprobados (Pre-A y Pre-B)

### 5. Final security audit

Lanzar security-auditor agent para review completo antes de declarar production-ready a 100K.

### 6. Documentación final

Generar escala-100k/results/capacity-100k.md con:
- Capacidad real medida (no la prometida)
- Cuellos de botella conocidos
- Cuándo va a hacer falta el siguiente upgrade
- Costos reales mensuales medidos en infra
- Margen de seguridad operativo

## Sub-tareas (TodoWrite)

- [ ] Triage de findings de E6
- [ ] escala-100k/results/fix-list-E7.md con priorización
- [ ] Arreglar bloqueante 1, 2, 3... (uno por uno con TDD)
- [ ] Re-correr E6 completo
- [ ] Verificar los 5 criterios
- [ ] Security audit final
- [ ] escala-100k/results/capacity-100k.md
- [ ] Update STATUS.md con la capacidad real verificada

## Reglas

- NO declarar "production-ready" sin los 5 criterios verificados
- NO parchear sin entender root cause (systematic-debugging)
- Verification-before-completion skill ANTES de claim "está listo"
- Si después de 2 iteraciones no se cumple un criterio, FRENAR y replantear

## Code review final

EN PARALELO sobre TODO el código nuevo de E1-E7:
- code-reviewer agent
- security-auditor agent
- performance-engineer agent
- refactoring-specialist agent

## Cierre del proyecto de escala

- Todos los checkboxes [x]
- ✅ en cada paso E1-E7 en escala-100k/PLAN.md
- STATUS.md con la capacidad final medida
- LESSONS.md cerrado con todo aprendido
- escala-100k/results/capacity-100k.md commiteado
- Commit: "feat(scale): Plan de Escala completo — sistema verificado para 100K pacientes"
- Tag git: "v2.0-scale-100k"

## Después de E7

El sistema está LISTO para venderse a clientes de hasta 100K afiliados con SLA serio.
Para 200K+ → empezar a planear sharding, multi-región. Pero NO antes.
```
