# Empezar sesión — Prompt para retomar contexto

Pegá este prompt cada vez que abrís Claude Code para trabajar en el plan de escala.
Claude va a leer lo justo, te dice dónde estás, y espera tu OK antes de hacer nada.

---

## Prompt para copiar y pegar

```
Estoy retomando el plan de escala del proyecto IPS.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Paso 1 — Leé SOLO estos 2 archivos

1. escala-100k/README.md — para entender la estructura
2. escala-100k/PLAN.md — para saber qué pasos hay y cuáles están completados

NO leas nada más todavía. NO ejecutes nada.

## Paso 2 — Decime en menos de 150 palabras

- Cuál fue el último paso completado (último checkbox [x] o ✅)
- En qué paso estamos parados
- Si hay algún Pre-Paso bloqueando (especialmente Pre-A de Meta)
- Cuál sería el próximo prompt a usar de escala-100k/prompts/
- Cuántos días/horas estimás para ese próximo paso

## Paso 3 — Esperá mi OK

NO arranques a ejecutar el siguiente paso todavía. Decime el resumen y esperá que yo te diga:
- "dale, arrancá con [paso]" → ahí sí, abrís el prompt correspondiente y ejecutás
- "primero hagamos otra cosa" → me hacés caso a mí
- "necesito pensarlo" → cerramos sesión tranquilos

## Reglas

- Las 6 reglas de CLAUDE.md son LEY (especialmente code review + commits + checkboxes)
- Si en el resumen detectás algo raro (un paso a medias, un commit colgado, un test roto) avisame
- No inventes progreso. Si el último checkbox marcado es de hace 2 semanas, decímelo así
```

---

## Cómo guardar este prompt para acceder rápido

Tenés 4 opciones, elegí la que más te sirva:

### Opción 1 — Desde este archivo (la más simple)
- Cada vez que abras Claude Code, abrís este archivo (`escala-100k/EMPEZAR.md`)
- Copiás el bloque dentro de las triple backticks
- Pegás en Claude

### Opción 2 — Como bookmark en el navegador
- Guardá la URL del archivo en GitHub/Drive como bookmark
- Click → copy → paste

### Opción 3 — Como nota en el celular
- Apple Notes / Google Keep / cualquier app de notas
- Pegás el bloque ahí
- Lo copiás desde el celular cuando lo necesites

### Opción 4 — Como snippet del sistema
- **Mac**: System Settings → Keyboard → Text Replacements → atajo "ipsstart" expande al prompt completo
- **Windows**: PhraseExpress / AutoHotkey con atajo similar
- Tipeás "ipsstart" y se expande solo

**La más práctica para tu flujo**: Opción 4 con un atajo tipo `;ipsstart`. Lo configurás una vez y nunca más volvés a abrir el archivo.

---

## Qué pasa cuando lo pegás

1. Claude lee README.md (≈30 segundos).
2. Claude lee PLAN.md (≈30 segundos).
3. Claude te tira un resumen tipo:
   > "Último paso completado: Pre-Paso C ✅. Pre-A está EN CURSO (esperando aprobación de Meta, 2 semanas). El próximo es **Paso E1 — Crons fuera del proceso**. Estimado: 3-4 días. Prompt a usar: `escala-100k/prompts/E1-crons.md`. ¿Arrancamos?"
4. Vos decidís: arrancar, posponer, cambiar de paso, o cerrar la sesión.

---

## Para cerrar tranquilo al final del día

Cuando termines una sesión, antes de cerrar Claude Code:

1. Confirmá que el paso actual quedó **commiteado** (mirá `git log --oneline -5`)
2. Confirmá que `PLAN.md` tiene los **checkboxes correctos** marcados
3. Confirmá que `STATUS.md` (raíz del proyecto) está **actualizado**
4. Si dejaste algo a medias: agregá una nota al final de `STATUS.md` tipo:
   ```
   ## Trabajo en progreso (2026-04-25)
   - Paso E2 a medias: implementé el módulo de dedup pero faltan los tests
   - Próximo: terminar tests + lanzar code-reviewer
   ```

Así cuando volvés y pegás el prompt de arriba, Claude lee STATUS.md y se entera del trabajo a medias.
