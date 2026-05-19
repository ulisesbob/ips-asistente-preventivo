# Pre-Paso C — Upgrade de infraestructura paga

**Tipo**: DevOps / configuración
**Tiempo estimado**: 1-2 días
**Costo extra**: USD 150-250/mes
**Skills**: dependency-audit, secrets-scan
**Agents**: cloud-architect, devops-engineer
**MCPs**: Context7 (Render, Neon, Upstash, Sentry)

---

## Prompt para copiar y pegar

```
Vamos a hacer el upgrade de infraestructura paga del proyecto IPS sin romper producción.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Lectura previa

1. CLAUDE.md (reglas, especialmente seguridad de datos)
2. escala-100k/PLAN.md sección "Pre-Paso C"
3. DEPLOY.md (cómo está deployado hoy)
4. STATUS.md sección "Infra y deploy"

## Investigación con Context7

Buscar docs ACTUALIZADAS de:
- Render: tier Starter Plus vs Pro vs autoscaling, cómo migrar sin downtime
- Neon: Pro tier (point-in-time recovery, branching, conexiones)
- Upstash Redis: setup, latencia, regiones más cercanas a Misiones (sa-east-1)
- Sentry: setup en Node.js + Next.js, sample rates

## Tareas (en este orden)

### 1. Auditoría previa
- Lanzar dependency-audit skill para ver si hay vulnerabilidades antes del upgrade
- Lanzar secrets-scan skill para confirmar que no hay secrets hardcodeados

### 2. Plan de migración (sin tocar prod todavía)
Crear escala-100k/results/pre-C-migracion-infra.md documentando:
- Costos estimados mensuales de cada servicio (no inventar, sacarlo de docs oficiales)
- Orden de migración recomendado (qué primero, qué después)
- Plan de rollback por servicio
- Variables de entorno nuevas que hay que agregar
- Cómo verificar que cada servicio está funcionando

### 3. Setup de cada servicio
Por cada servicio (Render Pro, Neon Pro, Upstash, Sentry, Better Uptime):
- Pasos exactos en la UI del proveedor
- Snippet de código mínimo para integrar (sin meterlo todavía)
- Test manual de validación

### 4. Validación
- Endpoint /health debe seguir respondiendo después de cada upgrade
- Tests existentes deben seguir pasando
- Latencia P95 no debe degradar

## Reglas

- NO subir nada que rompa lo que ya está corriendo en prod
- NO commitear secrets nunca (usar .env.example como referencia)
- Cada cambio de infra → snapshot de DB Neon antes
- Si algo se rompe, rollback inmediato y documentar en LESSONS.md

## Code review final

Lanzar cloud-architect agent para review del plan completo antes de ejecutar nada.

Commitear el plan. Marcar Pre-Paso C como ✅ solo cuando los 5 servicios estén funcionando y monitoreados.
```
