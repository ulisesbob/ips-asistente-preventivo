# Escala a 100K — Guía de uso

Esta carpeta tiene TODO lo necesario para llevar el sistema IPS de 500 a 100.000 pacientes.

## Estructura

```
escala-100k/
├── README.md              ← Este archivo, cómo usar todo
├── PLAN.md                ← El plan completo con checkboxes
├── prompts/               ← Un prompt copy-paste por cada paso
│   ├── pre-A-meta.md
│   ├── pre-B-templates.md
│   ├── pre-C-infra.md
│   ├── E1-crons.md
│   ├── E2-dedup.md
│   ├── E3-rate-limit.md
│   ├── E4-queries.md
│   ├── E5-observabilidad.md
│   ├── E6-load-test.md
│   └── E7-ajustes.md
└── results/               ← Acá se guardan outputs (audits, load test results, etc.)
```

---

## Cómo usar — paso a paso

### Día 1 — Arrancar

1. **Abrí PLAN.md** y leelo entero (5 min). Te da el panorama completo.
2. **Iniciá Pre-Paso A en paralelo** (verificación de Meta — tarda 2-8 semanas, no bloquea código):
   - Abrí Claude Code en la carpeta del proyecto.
   - Copiá el contenido de `prompts/pre-A-meta.md` y pegalo en Claude.
   - Claude te genera el checklist y los drafts. Vos arrancás el trámite con Meta hoy mismo.
3. **Iniciá Pre-Paso B en paralelo** (templates de mensaje):
   - Pegale `prompts/pre-B-templates.md` a Claude.
   - Te genera los 5 templates en formato listo para enviar a Meta.

### Día 2-3 — Infra paga

4. **Pre-Paso C** (upgrade de infra):
   - Pegale `prompts/pre-C-infra.md` a Claude.
   - Te guía para configurar Render Pro + Neon Pro + Upstash + Sentry.
   - **Importante**: este paso TIENE que estar terminado antes de E1.

### Semana 1-2 — Código (E1, E2, E3)

5. **Paso E1** (crons fuera del proceso):
   - Pegale `prompts/E1-crons.md`.
   - Claude trabaja con TDD, lanza code-reviewer, hace commit.
   - Cuando termine: revisá en PLAN.md que los checkboxes estén marcados.

6. **Paso E2** (dedup webhooks):
   - Pegale `prompts/E2-dedup.md`.
   - Igual flujo.

7. **Paso E3** (rate limit distribuido):
   - Pegale `prompts/E3-rate-limit.md`.

### Semana 3 — Optimización DB

8. **Paso E4** (queries y batching):
   - Pegale `prompts/E4-queries.md`.
   - Claude lanza database-optimizer + postgres-pro agents.
   - Genera `results/audit-queries-E4.md` con findings.

### Semana 3-4 — Observabilidad + Load test

9. **Paso E5** (observabilidad):
   - Pegale `prompts/E5-observabilidad.md`.
   - Configura Sentry + métricas + alertas + runbooks.

10. **Paso E6** (load test):
    - Pegale `prompts/E6-load-test.md`.
    - Resultados se guardan en `results/load-test-results-E6.md`.

### Semana 5-6 — Cierre

11. **Paso E7** (ajustes):
    - Pegale `prompts/E7-ajustes.md`.
    - Arregla lo que apareció en E6.
    - Cuando los 5 criterios de éxito final estén verificados → **listo para vender a clientes de 100K**.

---

## Reglas comunes a TODOS los pasos

Estas vienen de `CLAUDE.md` del proyecto y no son negociables:

1. **Code review obligatorio** al terminar cada paso (lanza `code-reviewer` agent).
2. **Marcar checkboxes** `[x]` en PLAN.md y agregar ✅ al título del paso.
3. **Commit obligatorio** con mensaje `feat(scale): Paso EN — descripción`.
4. **Actualizar STATUS.md** del proyecto (en la raíz, no en esta carpeta).
5. **Documentar errores nuevos** en LESSONS.md (raíz del proyecto).

---

## Qué hacer si te perdés

| Situación | Qué hacer |
|---|---|
| No sé en qué paso estoy | Abrí PLAN.md, mirá el último checkbox marcado |
| Claude se desvía y agrega cosas | Recordale "REGLA #1 y REGLA #2 de CLAUDE.md" |
| Un paso no me funciona | Frená, NO sigas al siguiente. Documentá en LESSONS.md |
| Quiero cambiar el plan | Editá PLAN.md primero, después el prompt afectado |
| Pre-A no avanza (Meta tarda) | Seguí con E1-E5 igual, solo bloquea producción real |

---

## Workflow visual

```
Día 1                  Día 2-3            Semana 1-2          Semana 3      Semana 4         Semana 5-6
─────────              ─────────          ──────────          ──────────    ──────────       ──────────
Pre-A (Meta)──────────────────────────────────────────────────────────────────►
Pre-B (Templates)────────────────────────────────────────────────────────────►
                       Pre-C (Infra)
                                          E1 (Crons)
                                          E2 (Dedup)
                                          E3 (Rate limit)
                                                              E4 (Queries)
                                                                            E5 (Obs)
                                                                            E6 (Load)
                                                                                            E7 (Ajustes)
                                                                                            ✅ Production-ready 100K
```

---

## Cuándo NO usar esta carpeta

- Si vas a hacer una feature nueva del producto (ej: nuevo endpoint, nueva pantalla del panel) → usá `PROMPT-CONTINUAR.md` de la raíz.
- Si vas a hacer un bug fix puntual sin tocar arquitectura → no necesitás esto.
- Si el cliente todavía no firmó nada → primero confirmá que vale la pena meter 4-6 semanas.

---

## Costo estimado del plan completo

| Concepto | Costo |
|---|---|
| Trabajo de código (4-6 semanas) | Tu tiempo |
| Infra extra mensual (Render Pro + Neon Pro + Redis + Sentry + uptime) | USD 150-250/mes |
| Trámites Meta (verificación + templates) | USD 0 (solo tiempo) |
| Abogado para Habeas Data (si vendés a IPS) | USD 5-10K (separado del plan) |

Ver PLAN.md para detalle por paso.
