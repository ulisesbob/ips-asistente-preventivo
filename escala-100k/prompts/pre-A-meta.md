# Pre-Paso A — Verificación de negocio en Meta

**Tipo**: Trámite externo (no es código)
**Tiempo estimado**: 2-8 semanas (depende de Meta)
**Bloqueante**: Sí, para mandar mensajes fuera de la lista blanca

---

## Prompt para copiar y pegar

```
Vamos a iniciar la verificación de negocio en Meta para el proyecto IPS.

Proyecto: C:/Users/Ulise/Desktop/ASISTENTE PREVENTIVO PARA PACIENTES CRONICOS/

## Lo que tenés que hacer

1. Leer escala-100k/PLAN.md sección "Pre-Paso A"
2. Usar WebFetch sobre developers.facebook.com/docs/development/release/business-verification para conseguir el listado oficial actualizado de documentación que pide Meta para verificar un negocio en Argentina
3. Generar un checklist concreto en escala-100k/results/pre-A-meta-checklist.md con:
   - Documentación legal argentina necesaria (CUIT, constancia de inscripción AFIP, balance, sitio web, dominio verificado, etc.)
   - Pasos exactos en Meta Business Manager (https://business.facebook.com)
   - Tiempos esperados por etapa
   - Errores comunes que hacen que rechacen (investigar)
   - Plan de contingencia si rechazan
4. Generar un draft de "Description of Business" en español e inglés que cumpla los requisitos de Meta para apps de salud
5. Generar un draft de "Use Case" describiendo el bot del IPS de forma honesta (recordatorios + atención administrativa + escalamiento humano + NO da consejos médicos)

## Reglas

- NO inventar requisitos. Si no encontrás info actualizada, decirlo explícitamente.
- Datos del negocio que necesito que me preguntes antes de redactar: razón social, CUIT, dirección fiscal, sitio web, dominio.
- Al terminar, commitear los archivos generados.
- Marcar Pre-Paso A como "EN CURSO" en escala-100k/PLAN.md (no completado, porque depende de Meta).

## Output esperado

- escala-100k/results/pre-A-meta-checklist.md con TODO listo para que yo arranque el trámite hoy
- Lista de los 5-10 errores más comunes de rechazo de Meta para apps de salud
- Estimación honesta de cuánto puede tardar
```
