# Paso E5 — Observabilidad enterprise

**Tipo**: Instrumentación + DevOps
**Tiempo estimado**: 3-4 días
**Skills**: nodejs-backend-patterns
**Agents**: observability-engineer, sre-engineer, incident-responder, code-reviewer
**MCPs**: Context7 (Sentry, OpenTelemetry, Grafana Cloud, Better Uptime)

---

## Prompt para copiar y pegar

```
Vamos a ejecutar el Paso E5: observabilidad enterprise.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Lectura previa

1. CLAUDE.md
2. LESSONS.md
3. escala-100k/PLAN.md sección "Paso E5"
4. SLO.md (si existe — ya está en la carpeta) leerlo entero
5. STATUS.md sección "Infra y deploy"

## Investigación con Context7

- Sentry para Node.js + Next.js: setup, sample rates, source maps, performance monitoring
- OpenTelemetry: instrumentación auto vs manual en Express
- Grafana Cloud (free tier) o Datadog: ingestion limits
- Better Uptime: synthetic checks, alertas

## Activar agents

- observability-engineer agent para diseño de instrumentación
- sre-engineer agent para definir SLIs/SLOs y políticas de alerta
- incident-responder agent para diseñar runbooks

## Tareas

### 1. Instrumentación

- Sentry en API y panel (errores con contexto, source maps, ignore noisy errors)
- Logs estructurados JSON con request ID en toda la cadena (pino o winston)
- Métricas con OpenTelemetry SDK → Grafana Cloud OTLP endpoint

### 2. Métricas que tienen que existir

- mensajes_recibidos_total (counter, label: tipo)
- mensajes_enviados_total (counter, label: status)
- bot_response_latency (histogram, p50/p95/p99)
- claude_api_latency (histogram)
- claude_api_errors_total (counter, label: error_type)
- db_pool_size, db_pool_used (gauge)
- cron_lag_seconds (gauge — lag entre scheduled y started)
- cron_duration_seconds (histogram por cron)
- webhook_dedup_total (counter del E2)
- rate_limit_hits_total (counter del E3)

### 3. Dashboard

Diseñar 1 dashboard ejecutivo en Grafana con:
- Mensajes/seg en tiempo real
- Latencia P95 del bot
- Tasa de errores 5xx
- Estado de los 4 crons (última ejecución, lag)
- Conexiones DB
- Costos estimados (Claude tokens consumidos)

### 4. Alertas críticas

Definir en sre-engineer (con políticas de severidad):
- P0 (despertar a alguien): bot responde en >60s, cron no ejecutó en 24h, DB inaccesible
- P1 (notificar pero no despertar): error rate > 1%, latencia P95 > 5s
- P2 (ticket de día siguiente): warnings, métricas de capacidad

### 5. Runbooks

Crear escala-100k/results/runbooks/ con un MD por escenario crítico:
- runbook-bot-down.md
- runbook-cron-stuck.md
- runbook-db-down.md
- runbook-meta-rate-limit.md
- runbook-claude-api-down.md

Cada runbook: síntoma, diagnóstico, mitigación inmediata, escalación, post-mortem.

### 6. SLOs

Definir en SLO.md:
- Disponibilidad bot: 99.5%
- Latencia respuesta bot P95: < 3s
- Cron de controles: ejecuta diariamente entre 8:00 y 8:30 AM Argentina
- Mensajes WhatsApp delivery: > 98% en < 5 min

## Sub-tareas (TodoWrite)

- [ ] Setup Sentry API + panel
- [ ] Setup OpenTelemetry + Grafana Cloud
- [ ] Setup Better Uptime con synthetic checks de /health y /webhooks/whatsapp
- [ ] Logs estructurados JSON con request ID
- [ ] Las 10 métricas custom listadas
- [ ] Dashboard ejecutivo
- [ ] Alertas P0/P1/P2 configuradas
- [ ] 5 runbooks
- [ ] SLOs documentados
- [ ] Test: provocar errores → verificar que llegan alertas

## Reglas

- NO loggear PII en métricas (no DNIs, no nombres, no teléfonos)
- Sample rate de Sentry conservador (1-5%) para no quemar la cuota
- Source maps SIEMPRE (sino los stack traces son inútiles)
- Cada alerta debe tener un runbook asociado, sino no es alerta válida

## Code review

EN PARALELO:
- observability-engineer agent
- sre-engineer agent
- code-reviewer agent

## Cierre

- Checkboxes + ✅ en escala-100k/PLAN.md
- STATUS.md
- SLO.md actualizado
- LESSONS.md
- escala-100k/results/runbooks/ commiteado
- Commit: "feat(scale): Paso E5 — observabilidad, SLOs y runbooks"
```
