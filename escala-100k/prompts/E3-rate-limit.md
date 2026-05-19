# Paso E3 — Rate limit y concurrencia distribuidos

**Tipo**: Código backend
**Tiempo estimado**: 3-4 días
**Skills**: nodejs-backend-patterns, cost-aware-llm-pipeline, test-driven-development
**Agents**: backend-developer, performance-engineer, code-reviewer
**MCPs**: Context7 (token bucket Redis, ioredis, Anthropic SDK rate limits)

---

## Prompt para copiar y pegar

```
Vamos a ejecutar el Paso E3: rate limit y concurrencia distribuidos.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Lectura previa

1. CLAUDE.md
2. LESSONS.md (lección sobre rate limit Meta y backoff)
3. escala-100k/PLAN.md sección "Paso E3"
4. apps/api/src/services/whatsapp.ts (sender)
5. apps/api/src/services/ai.ts (Claude API caller)
6. STATUS.md sección "Configuración técnica" del bot

## Investigación con Context7

- Algoritmo token bucket distribuido en Redis (script Lua atómico)
- ioredis o @upstash/redis Lua eval
- Anthropic SDK rate limits actuales para Claude Sonnet 4.6 y Haiku 4.5
- Meta WhatsApp Cloud API rate limits por tier (estándar verificado vs no verificado)

## Activar skill cost-aware-llm-pipeline

Para revisar la lógica actual de routing Sonnet → Haiku y optimizar costos.

## Implementación TDD

Dos componentes separados:

### A. Rate limiter para WhatsApp
- Token bucket en Redis con script Lua atómico
- Rate configurable por env (default: 200 msg/seg con tier verificado)
- Backoff exponencial cuando hit el límite
- Test: 3 instancias mandando 100 msg/s cada una → rate efectivo combinado = 200, no 300

### B. Semáforo distribuido para Claude API
- Counter en Redis con TTL
- Concurrencia global: 50 simultáneas (no por instancia)
- Cola de espera con timeout
- Test: 100 requests simultáneos desde 3 instancias → solo 50 corren a la vez

## Sub-tareas (TodoWrite)

- [ ] Implementar rate limiter token bucket Lua
- [ ] Reemplazar el setTimeout(100) actual del whatsapp sender
- [ ] Implementar semáforo Claude API
- [ ] Reemplazar el "max 50 concurrent" actual del ai service
- [ ] Métricas: rate efectivo, llamadas en cola, tiempos de espera P95
- [ ] Tests unitarios + integración
- [ ] Stress test local con K6 (1000 msg/seg target → debe limitarse al rate config)

## Reglas

- Atomicidad ABSOLUTA en el rate limiter (Lua eval, NO check-then-set)
- Si Redis se cae: fallback a rate limit local conservador (no abrir el grifo)
- Si la cola del semáforo crece sin parar: alerta + 503 al cliente
- Métricas obligatorias

## Code review

EN PARALELO:
- code-reviewer
- performance-engineer (review crítico del algoritmo)
- backend-developer (segunda opinión)

## Cierre

- Checkboxes [x] + ✅ en escala-100k/PLAN.md
- STATUS.md
- LESSONS.md con el algoritmo elegido
- Commit: "feat(scale): Paso E3 — rate limit y semáforo distribuidos"
```
