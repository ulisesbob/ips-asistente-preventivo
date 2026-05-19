# Plan de Escala — De 500 a 100.000 pacientes

## Contexto

El sistema actual está validado para **~500 pacientes**. Para vender al IPS Misiones (215K afiliados) o a cualquier obra social provincial, necesitamos llevarlo de forma segura a **100.000 personas como techo comercial seguro**.

Hay 4 cosas en el código que funcionan con 500 pacientes y se rompen con 100K. Este plan las arregla.

---

## Reglas obligatorias (vienen de CLAUDE.md)

- Code review al terminar cada paso (REGLA #4)
- Marcar checkboxes `[x]` y ✅ en este archivo al completar cada paso (REGLA #5)
- Commit al terminar cada paso (REGLA #6)
- Actualizar STATUS.md al terminar cada paso
- Documentar errores nuevos en LESSONS.md

**No saltear pasos. No agregar features de producto, solo escala.**

---

## Criterios de éxito final

El sistema entra en producción a 100K cuando se cumplen los 5 criterios:

1. ✅ Load test con 100K pacientes sintéticos pasa sin pérdida de mensajes ni duplicados.
2. ✅ Cron de las 8 AM procesa 5.000 recordatorios vencidos en menos de 30 minutos sin tirar el sistema.
3. ✅ Con 3 instancias corriendo en paralelo, ningún paciente recibe el mismo mensaje dos veces.
4. ✅ El rate limit hacia Meta WhatsApp se respeta de forma global (no por instancia).
5. ✅ Verificación de negocio en Meta APROBADA + al menos 5 templates de mensaje aprobados.

---

## Pre-requisitos (arrancar YA, no son código)

### Pre-Paso A — Verificación de negocio en Meta 🔴 BLOQUEANTE EXTERNO

- [ ] Iniciar trámite de verificación de negocio en Meta Business Manager
- [ ] Subir documentación de la empresa (CUIT, balance, sitio web)
- [ ] Vincular dominio verificado
- [ ] Esperar aprobación (2-8 semanas, depende de Meta)
- [ ] Sin esto, NO se puede mandar mensajes a más allá de la lista blanca

**Importante**: este paso corre en paralelo con todos los demás. Si Meta tarda, el código puede estar listo igual.

### Pre-Paso B — Templates de mensaje aprobados

- [ ] Diseñar 5 templates obligatorios:
  - [ ] Recordatorio de control vencido
  - [ ] Recordatorio de medicación
  - [ ] Encuesta post-control
  - [ ] Bienvenida a programa
  - [ ] Notificación de cambio de turno
- [ ] Enviar a aprobación (24-72h por template)
- [ ] Resolver rechazos si los hay

### Pre-Paso C — Upgrade de infraestructura paga

- [ ] Render: pasar de Free a Starter Plus o Pro (USD 25-85/mes)
- [ ] Neon: pasar a Pro tier (USD 70/mes) — point-in-time recovery + más conexiones
- [ ] Redis (Upstash): tier pago (USD 10-30/mes) — para deduplicación y rate limit distribuidos
- [ ] Sentry: tier developer (USD 26/mes) — error tracking
- [ ] Better Uptime o UptimeRobot Pro: USD 18/mes — alertas serias
- [ ] **Costo total infra adicional**: ~USD 150-250/mes

---

## Paso E1 — Crons fuera del proceso

**Problema actual**: `node-cron` corre adentro del proceso de Node. Con 2-3 instancias en Render, los crons disparan 2-3 veces y los pacientes reciben mensajes duplicados.

**Solución**: mover los 4 crons a un mecanismo que dispare una sola vez, sin importar cuántas instancias haya.

### Tareas

- [ ] Decidir entre dos opciones (documentar la decisión en LESSONS.md):
  - Opción A: Render Cron Jobs nativo (job separado del web service)
  - Opción B: Leader election con Postgres advisory locks (`pg_try_advisory_lock`)
- [ ] Migrar el cron de recordatorios de controles (8 AM)
- [ ] Migrar el cron de recordatorios de medicación (cada 30 min)
- [ ] Migrar el cron de encuestas post-control (10 AM)
- [ ] Migrar el cron de recordatorios autogestivos (cada 30 min)
- [ ] Agregar logging: cuál instancia ejecutó el cron y cuándo
- [ ] Endpoint `/health/cron` debe reportar última ejecución exitosa de cada job
- [ ] Tests: simular 3 instancias compitiendo, verificar que solo 1 dispara

### Verificación

- [ ] Levantar 3 instancias en local (docker-compose con 3 réplicas)
- [ ] Esperar a que dispare el cron
- [ ] Confirmar en logs que solo 1 instancia lo ejecutó
- [ ] Confirmar en DB que se mandó 1 sola vez por paciente

### Code review obligatorio
- [ ] Lanzar `code-reviewer` agent al terminar
- [ ] Arreglar todos los findings antes de avanzar

---

## Paso E2 — Deduplicación persistente de webhooks

**Problema actual**: el `Set` en memoria con 5000 IDs vive en RAM de una sola instancia. Si Meta reenvía un webhook (lo hace cuando no respondés en tiempo) y le toca a otra instancia, se procesa de nuevo y se duplica el mensaje en la conversación.

**Solución**: mover la dedup a un store compartido entre instancias.

### Tareas

- [ ] Decidir entre Redis (Upstash) o tabla `webhook_events` con TTL
- [ ] Reemplazar `Set` in-memory por el store distribuido
- [ ] TTL razonable: 24 horas (Meta no reenvía después de eso)
- [ ] Métricas: contar dedups por hora (debería ser bajo, si crece hay problema)
- [ ] Manejo de fallback: si Redis se cae, NO procesar el webhook (mejor perder uno que duplicar)
- [ ] Tests unitarios: dedup correcta entre instancias

### Verificación

- [ ] Simular Meta reenviando el mismo webhook 5 veces a 3 instancias distintas
- [ ] Confirmar que solo 1 mensaje aparece en la tabla `messages`
- [ ] Confirmar que solo 1 respuesta del bot se envía

### Code review obligatorio
- [ ] Lanzar `code-reviewer` + `security-auditor`

---

## Paso E3 — Rate limit y concurrencia distribuidos

**Problema actual**: 
- "100ms entre envíos WhatsApp" es por instancia. Con 3 instancias = 1 envío cada 33ms = supera el rate limit de Meta.
- "Máx 50 llamadas AI simultáneas" es por instancia. Con 3 instancias = 150 simultáneas reales.

**Solución**: rate limit y semáforo globales basados en Redis.

### Tareas

- [ ] Implementar rate limiter distribuido para envíos a WhatsApp (algoritmo token bucket en Redis)
- [ ] Configurar conforme al tier de Meta (250 mensajes/seg con tier estándar verificado)
- [ ] Implementar semáforo distribuido para llamadas a Claude API
- [ ] Configurar concurrencia global: 50 simultáneas TOTAL, no por instancia
- [ ] Backoff exponencial cuando se hit el límite
- [ ] Métricas: rate efectivo de envíos, llamadas AI/seg, esperas en cola

### Verificación

- [ ] Test de carga: 3 instancias mandando 1000 mensajes cada una
- [ ] Confirmar que el rate combinado no supera el límite de Meta
- [ ] Confirmar que las llamadas AI simultáneas no superan 50

### Code review obligatorio
- [ ] Lanzar `code-reviewer` + `performance-engineer`

---

## Paso E4 — Optimización de queries y batching

**Problema actual**: el cron de las 8 AM hace queries no optimizadas para volumen. Con 100K pacientes, traer todos a memoria de una vez explota el proceso o tarda demasiado.

### Tareas

- [ ] Correr `EXPLAIN ANALYZE` sobre todas las queries del cron
- [ ] Crear índices necesarios:
  - [ ] `(consent, nextReminderDate)` en `patient_programs` — para el cron de controles
  - [ ] `(active, scheduledFor)` en `medication_reminders` — para el cron de medicación
  - [ ] `(status, reminderDate)` en `patient_self_reminders`
  - [ ] `(createdAt)` en `messages` — para queries de panel paginado
- [ ] Batching del cron de controles: procesar de a 500 pacientes
- [ ] Paralelización de envíos: worker pool con concurrencia controlada
- [ ] Paginación cursor-based en endpoints de listado (no offset, que se degrada)
- [ ] Caché en `programs` y `knowledge_base` (Redis con TTL 5 min) — son lecturas masivas
- [ ] Eliminar N+1 queries en panel (usar `include` de Prisma correctamente)

### Verificación

- [ ] Cron de controles con 50.000 pacientes vencidos: termina en menos de 30 min
- [ ] Endpoint `/api/patients` con 100K registros: P95 < 500ms
- [ ] Endpoint de búsqueda por DNI con 100K registros: P95 < 100ms

### Code review obligatorio
- [ ] Lanzar `database-optimizer` + `performance-engineer`

---

## Paso E5 — Observabilidad enterprise

**Problema actual**: si algo se rompe en producción, no nos enteramos hasta que el cliente se queja.

### Tareas

- [ ] Integrar Sentry en API y panel (errores con contexto, source maps)
- [ ] Métricas con OpenTelemetry → Grafana Cloud o Datadog:
  - [ ] Mensajes recibidos/segundo
  - [ ] Mensajes enviados/segundo
  - [ ] Latencia P50/P95/P99 de respuesta del bot
  - [ ] Latencia de Claude API
  - [ ] Errores 5xx/min
  - [ ] Conexiones activas a DB
  - [ ] Lag del cron (tiempo entre scheduled y started)
- [ ] Dashboard con esos KPIs
- [ ] Alertas críticas:
  - [ ] Bot no responde en 60s → alerta
  - [ ] Cron no ejecutó en 24h → alerta
  - [ ] Errores 5xx > 1% → alerta
  - [ ] DB conexiones > 80% del pool → alerta
- [ ] Logs estructurados (JSON) con request ID en toda la cadena

### Verificación

- [ ] Provocar un error a propósito en staging → llega a Sentry
- [ ] Tirar el cron a propósito → dispara alerta
- [ ] Dashboard muestra datos reales en tiempo real

### Code review obligatorio
- [ ] Lanzar `observability-engineer` (si existe) o `code-reviewer`

---

## Paso E6 — Load test con 100K usuarios simulados

**Objetivo**: probar el sistema completo a la escala objetivo antes de prometérsela a un cliente.

### Tareas

- [ ] Setup ambiente staging idéntico a producción (mismo Render Pro, misma Neon Pro)
- [ ] Generar 100.000 pacientes sintéticos (script seed) con distribución realista por programa
- [ ] Generar 30.000 conversaciones históricas para que la DB tenga volumen real
- [ ] Setup K6 o Artillery con escenarios:
  - [ ] **Escenario 1**: pico de webhooks (5.000 mensajes entrantes en 5 min, simulando rato de mucho tráfico)
  - [ ] **Escenario 2**: cron de 8 AM con 5.000 pacientes vencidos
  - [ ] **Escenario 3**: panel con 50 médicos consultando concurrentemente
  - [ ] **Escenario 4**: importación CSV de 10.000 pacientes
  - [ ] **Escenario 5**: combinado — todo lo anterior al mismo tiempo
- [ ] Documentar resultados: RPS soportado, latencia P99, error rate, uso de CPU/RAM/DB
- [ ] Identificar el cuello de botella real

### Criterios de aceptación

- [ ] Escenario 1: 0 mensajes perdidos, 0 duplicados, latencia P95 < 3s
- [ ] Escenario 2: termina en menos de 30 min, 0 duplicados
- [ ] Escenario 3: latencia P95 < 1s
- [ ] Escenario 4: termina en menos de 5 min, 0 errores de UPSERT
- [ ] Escenario 5: el sistema NO se cae, latencia degrada pero se recupera

### Code review obligatorio
- [ ] Documentar todos los hallazgos en `load-test-results.md`
- [ ] Lanzar `performance-engineer` para revisar resultados

---

## Paso E7 — Ajustes post load-test

Lo que aparezca en el load test que no esté bien, arreglarlo acá.

### Tareas

- [ ] Listar problemas encontrados en E6
- [ ] Priorizar por criticidad (bloqueante / mejorable / cosmético)
- [ ] Arreglar bloqueantes
- [ ] Re-correr el load test
- [ ] Iterar hasta cumplir los 5 criterios de éxito final

### Code review obligatorio
- [ ] Code review final completo del sistema
- [ ] Security audit antes de cualquier deploy a producción real con clientes nuevos

---

## Estimación de tiempo

| Paso | Trabajo | Calendario |
|---|---|---|
| Pre-A (Meta) | Burocracia | 2-8 semanas (paralelo) |
| Pre-B (Templates) | Diseño + envío | 1-2 semanas (paralelo) |
| Pre-C (Infra paga) | Configuración | 1-2 días |
| E1 (Crons) | 3-4 días | Semana 1 |
| E2 (Dedup webhooks) | 1-2 días | Semana 1 |
| E3 (Rate limit distribuido) | 3-4 días | Semana 2 |
| E4 (Queries y batching) | 4-5 días | Semana 2-3 |
| E5 (Observabilidad) | 3-4 días | Semana 3 |
| E6 (Load test) | 3-4 días | Semana 4 |
| E7 (Ajustes) | 1 semana | Semana 5-6 |
| **Total código** | **4-6 semanas** | |
| **Total real (con Meta)** | **6-10 semanas** | |

---

## Lo que NO entra en este plan

- Features nuevas de producto (eso es Fase 2 separada)
- Sharding de DB (recién a partir de 500K pacientes tiene sentido)
- Multi-región (recién si IPS necesita HA geográfico)
- Migración a Kubernetes (sobreingeniería para esta escala)
- Reescritura del bot en otro lenguaje

**Si aparece la tentación de meter algo de esto, releer CLAUDE.md y este encabezado.**
