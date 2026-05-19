# Pre-Paso B — Templates de mensaje aprobados por Meta

**Tipo**: Diseño de mensajes + trámite Meta
**Tiempo estimado**: 1-2 semanas (24-72h por template + revisiones)
**Skills**: claude-api
**Agents**: prompt-engineer

---

## Prompt para copiar y pegar

```
Vamos a diseñar los 5 templates de mensaje obligatorios para Meta WhatsApp Business.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Contexto

Leer en este orden:
1. CLAUDE.md sección "Bot — reglas"
2. escala-100k/PLAN.md sección "Pre-Paso B"
3. STATUS.md sección "Bot — Capacidades" para entender el tono actual de "Ana"
4. spec.md sección de programas (los 9 programas oficiales)

## Investigación previa

Usar Context7 para buscar docs actualizadas de WhatsApp Business Cloud API → message templates. Específicamente las categorías UTILITY vs MARKETING vs AUTHENTICATION y cuándo aplica cada una en Argentina.

Usar WebFetch sobre la doc oficial de Meta sobre template guidelines para apps de salud, para no caer en rechazo.

## Tarea

Diseñar 5 templates en español argentino, tono de "Ana" (cálido pero profesional), con:

1. Recordatorio de control vencido (categoría UTILITY) — variables: {{1}} nombre, {{2}} programa, {{3}} fecha control
2. Recordatorio de medicación (categoría UTILITY) — variables: {{1}} medicamento, {{2}} dosis, {{3}} hora
3. Encuesta post-control (categoría UTILITY) — variables: {{1}} nombre, {{2}} programa
4. Bienvenida a programa (categoría UTILITY) — variables: {{1}} nombre, {{2}} programa, {{3}} próximo control
5. Notificación de cambio de turno (categoría UTILITY) — variables: {{1}} nombre, {{2}} fecha vieja, {{3}} fecha nueva

## Reglas estrictas

- NUNCA promesas terapéuticas
- NUNCA frases que parezcan diagnóstico
- INCLUIR siempre el opt-out: "Respondé BAJA si no querés recibir más mensajes"
- INCLUIR el disclaimer "Información orientativa. Comuníquese al 0800-888-0109"
- Cumplir guidelines de Meta para apps de salud
- Texto plano, máx 1024 caracteres por template

## Output esperado

Archivo escala-100k/results/templates-meta.md con:
- Los 5 templates en español + variables documentadas
- Justificación de la categoría UTILITY de cada uno
- Predicción de riesgo de rechazo (alto/medio/bajo) por template
- Si alguno tiene riesgo alto, propuesta alternativa

Después lanzar prompt-engineer agent para review crítico antes de enviar a Meta.

Commitear el archivo. NO marcar Pre-Paso B como completado hasta que Meta apruebe los 5.
```
