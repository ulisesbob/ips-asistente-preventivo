# Paso E6 — Load test con 100K usuarios simulados

**Tipo**: QA / testing de carga
**Tiempo estimado**: 3-4 días
**Skills**: webapp-testing, systematic-debugging
**Agents**: qa-expert, test-automator, chaos-engineer, performance-engineer, error-detective
**MCPs**: Context7 (K6, Artillery, Grafana K6 cloud)

---

## Prompt para copiar y pegar

```
Vamos a ejecutar el Paso E6: load test con 100K usuarios simulados.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Lectura previa

1. CLAUDE.md
2. LESSONS.md
3. escala-100k/PLAN.md sección "Paso E6"
4. SLO.md (los SLOs definidos en E5 son lo que tenemos que cumplir)
5. Resultados de E1, E2, E3, E4, E5 — ya tienen que estar mergeados

## Investigación con Context7

- K6 vs Artillery: cuál para qué escenario
- K6 scenarios: ramp-up, constant arrival rate, stress
- Generación de datos sintéticos realistas (faker.js)
- Webhook simulation a escala

## Activar agents

- test-automator agent para diseñar el harness
- chaos-engineer agent para diseñar escenarios adversarios
- performance-engineer agent para análisis de resultados

## Tareas

### 1. Ambiente staging idéntico a prod

- Render Pro con misma config que prod
- Neon Pro con branch dedicado para load test
- Upstash Redis dedicado (no compartir con prod)
- Sentry/Grafana en staging para ver métricas en tiempo real

### 2. Datos sintéticos

Script de seed que genere:
- 100.000 pacientes con distribución realista por programa (ej: 25% diabetes, 20% hipertensión, etc.)
- 30.000 conversaciones históricas (1-15 mensajes c/u)
- 5.000 medication_reminders activos
- 1.000 patient_self_reminders activos
- DNIs únicos, teléfonos válidos pero falsos (no mandar a Meta de verdad — mock del sender)

### 3. Harness con K6

5 escenarios del plan:
- E6-1: Pico de webhooks (5.000 entrantes en 5 min)
- E6-2: Cron 8 AM con 5.000 vencidos
- E6-3: 50 médicos consultando concurrentemente desde panel
- E6-4: Importación CSV de 10.000 pacientes
- E6-5: Combinado de los 4 anteriores

### 4. Mock del sender de WhatsApp

NO mandar mensajes reales en el load test. Mock que simula latencia y rate limit de Meta.

### 5. Ejecución

Cada escenario por separado primero, después combinado. Recolectar:
- RPS sostenido
- Latencia P50/P95/P99
- Error rate
- CPU/RAM/DB conexiones a lo largo del test
- Mensajes perdidos (debe ser 0)
- Mensajes duplicados (debe ser 0)

### 6. Análisis con error-detective y performance-engineer

Lanzar agents para:
- Identificar cuellos de botella reales
- Cazar bugs que solo aparecen a escala
- Proyectar capacidad máxima real (cuántos pacientes soporta antes de degradar)

## Sub-tareas (TodoWrite)

- [ ] Setup ambiente staging
- [ ] Script seed 100K pacientes sintéticos
- [ ] Mock sender de WhatsApp
- [ ] Harness K6 con los 5 escenarios
- [ ] Ejecutar E6-1 → documentar
- [ ] Ejecutar E6-2 → documentar
- [ ] Ejecutar E6-3 → documentar
- [ ] Ejecutar E6-4 → documentar
- [ ] Ejecutar E6-5 → documentar
- [ ] Análisis combinado con agents
- [ ] Generar escala-100k/results/load-test-results-E6.md

## Criterios de aceptación (del plan)

- [ ] E6-1: 0 mensajes perdidos, 0 duplicados, P95 < 3s
- [ ] E6-2: termina < 30 min, 0 duplicados
- [ ] E6-3: P95 < 1s
- [ ] E6-4: termina < 5 min, 0 errores UPSERT
- [ ] E6-5: sistema NO se cae, latencia degrada pero recupera

## Reglas

- NO ejecutar load test contra prod (NUNCA)
- Mock del sender de WhatsApp obligatorio (sino se rompe Meta y nos banean)
- Cada escenario debe tener un teardown que limpie staging
- Si el test rompe staging, documentar el bug y NO intentar arreglarlo en E6 — eso va a E7

## Cierre

- Checkboxes + ✅ en escala-100k/PLAN.md
- STATUS.md
- escala-100k/results/load-test-results-E6.md commiteado
- LESSONS.md con todo lo descubierto
- Commit: "test(scale): Paso E6 — load test 100K pacientes, resultados documentados"
```
