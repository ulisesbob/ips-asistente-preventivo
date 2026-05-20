# Deploy — IPS Asistente Preventivo

## Pre-Deployment Checklist

### Antes de deployar
- [ ] Build API exitoso (`npm run build:api`)
- [ ] Build Web exitoso (`npm run build:web`)
- [ ] Prisma generate sin errores (`npm run db:generate`)
- [ ] Variables de entorno configuradas (ver abajo)
- [ ] JWT_SECRET generado con 64+ chars (`openssl rand -base64 64`)
- [ ] ADMIN_PASSWORD definido para seed de producción
- [ ] Rollback plan: `git revert` del último commit de deploy

### Variables de entorno

#### Railway (API)
| Variable | Requerida | Ejemplo |
|----------|-----------|---------|
| `DATABASE_URL` | Auto (Railway Postgres) | `postgresql://...` |
| `JWT_SECRET` | Si | 64+ chars |
| `PRISMA_FIELD_ENCRYPTION_KEY` | **Si** | `k1.aesgcm256.<base64>` (`npx cloak generate`) |
| `NODE_ENV` | Si | `production` |
| `PORT` | No (default 3001) | `3001` |
| `FRONTEND_URL` | Si | `https://ips-panel.vercel.app` |
| `WHATSAPP_ACCESS_TOKEN` | Para bot | Token de Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | Para bot | ID de Meta |
| `WHATSAPP_VERIFY_TOKEN` | Para bot | String custom |
| `WHATSAPP_APP_SECRET` | Para bot | Secret de Meta |
| `ANTHROPIC_API_KEY` | Para AI | `sk-ant-...` |
| `REMINDER_CRON` | No (default 8AM AR) | `0 8 * * *` |

#### Vercel (Web)
| Variable | Requerida | Ejemplo |
|----------|-----------|---------|
| `NEXT_PUBLIC_API_URL` | Si | `https://ips-api.up.railway.app` |

---

## 1. Deploy API en Render

### Dockerfile (activo)
1. Crear Web Service en Render conectado al repo de GitHub
2. Render detecta `Dockerfile` automáticamente
3. Configurar variables de entorno en Render Dashboard → Environment
4. DB: Neon PostgreSQL (externo, no addon de Render)
5. Deploy automático en cada push a `main`

**Nota:** Render Free duerme containers después de 15 min de inactividad (~50s cold start). Para producción real, usar plan Starter ($7/mes).

### Seed producción
Después del primer deploy, ejecutar en Render Shell:
```bash
ADMIN_PASSWORD=TuPasswordSeguro123! npm run db:seed:prod
```

### Cifrado en reposo (PII clínica) — CRÍTICO

`PatientNote.content` y `Message.content` se cifran en la DB con
`prisma-field-encryption` (AES-GCM 256). Pasos para activarlo en producción:

1. **Generar la clave de producción** (una sola vez, distinta a la de dev):
   ```bash
   npx cloak generate
   ```
   Guardar el valor `k1.aesgcm256...` en `PRISMA_FIELD_ENCRYPTION_KEY`
   (Render → Environment). **NO** commitearla ni reusar la de dev/test.

2. ⚠️ **Si se pierde esta clave, los datos cifrados son IRRECUPERABLES.**
   Guardar una copia en el gestor de secretos / vault del equipo.

3. **Aplicar la migración** (cambia `patient_notes.content` a TEXT):
   ```bash
   npm run db:migrate:deploy
   ```

4. **Backfill del histórico** (cifra las filas que ya estaban en texto plano).
   Las filas nuevas se cifran solas; las viejas siguen legibles hasta correr esto:
   ```bash
   DRY_RUN=1 npx tsx packages/db/src/backfill-encrypt.ts   # previsualizar
   npx tsx packages/db/src/backfill-encrypt.ts             # ejecutar (idempotente)
   ```

5. **Rotación de clave** (a futuro): generar una nueva con `npx cloak generate`,
   ponerla como nueva `PRISMA_FIELD_ENCRYPTION_KEY` y la vieja en
   `PRISMA_FIELD_DECRYPTION_KEYS` (CSV), luego re-correr el backfill.

> Pendiente (fase 2): cifrado de `dni`/`phone`. Requiere columnas hash
> determinísticas (`dniHash`/`phoneHash`) porque son `@unique` y se buscan por
> valor exacto en el hot path del bot. Hacerlo en ventana de mantenimiento.

---

## 2. Deploy Panel en Vercel

1. Importar repo en Vercel
2. **Root Directory:** `apps/web`
3. **Build command:** `cd ../.. && npm ci && npm run db:generate && cd apps/web && npm run build`
4. **Output directory:** `.next`
5. **Install command:** (dejar vacío, se maneja en build)
6. Agregar env var: `NEXT_PUBLIC_API_URL=https://ips-api.up.railway.app`
7. Deploy

---

## 3. Configurar WhatsApp (Meta Cloud API)

1. Ir a Meta Business Manager → App → WhatsApp → Configuration
2. **Callback URL:** `https://ips-api.up.railway.app/api/webhooks/whatsapp`
3. **Verify token:** el valor de `WHATSAPP_VERIFY_TOKEN`
4. Suscribirse a: `messages`
5. Crear template de mensaje para cada programa en Meta Business Manager
6. Enviar a aprobación de Meta (24-48hs)

---

## 4. Post-Deploy Checklist

- [ ] Health check: `GET https://ips-api.up.railway.app/health` → `{"status":"ok"}`
- [ ] Login funciona: abrir panel, hacer login con admin
- [ ] Dashboard carga: métricas visibles
- [ ] 9 programas visibles en /programas
- [ ] Webhook verificado: Meta muestra "Verified" en configuración
- [ ] Bot responde: enviar mensaje al número de WhatsApp
- [ ] Recordatorio: cron log muestra ejecución a las 8AM AR
- [ ] CORS: no hay errores de CORS en browser console

---

## 5. Rollback

### API (Railway)
Railway mantiene historial de deploys. Click "Redeploy" en el deploy anterior.

### Web (Vercel)
Vercel mantiene snapshots. Click "Promote to Production" en el deploy anterior.

### DB
Prisma migrations son forward-only. Para revertir:
1. Crear nueva migración que deshaga los cambios
2. `npx prisma migrate deploy`

---

## 6. Monitoreo

### Health endpoints
| Endpoint | Propósito | UptimeRobot? |
|----------|-----------|-------------|
| `GET /health` | Liveness. Proceso vivo. <200ms. | Si |
| `GET /health/deep` | DB connectivity. 503 si falla. | No |
| `GET /health/cron` | Último cron run + resultado. | No |

### Logs (structured JSON)
- Railway: Dashboard → Logs (filtrar por `event: http_request`, `cron_result`, `whatsapp`, `ai`)
- Vercel: Dashboard → Functions → Logs

### Free monitoring stack
- **UptimeRobot** (free): ping `/health` cada 5 min → email si cae
- **Healthchecks.io** (free): ping al final del cron → alerta si no llega por 8:30 AM
- **Vercel Analytics** (built-in): Speed Insights, function errors

### Métricas clave
- Recordatorios enviados/fallidos (log del cron — `event: cron_result`)
- Tiempo de respuesta del bot (webhook → response — `event: whatsapp`)
- Errores 5xx en API (`event: http_request`, `statusCode >= 500`)
- Login failures

---

## 7. Estimación de Costos

| Servicio | Plan | Costo estimado/mes |
|----------|------|-------------------|
| Railway (API + PostgreSQL) | Hobby → Pro si crece | $5-20 USD |
| Vercel (Panel Next.js) | Hobby (gratis) | $0 USD |
| Meta Cloud API (WhatsApp) | Gratis hasta 1000 conv/mes | $0 USD |
| Anthropic (Claude Haiku) | Pay-per-use | $1-5 USD |
| UptimeRobot | Free tier | $0 USD |
| Healthchecks.io | Free tier | $0 USD |
| **Total estimado** | | **$6-25 USD/mes** |

### Optimizaciones de costo
- Railway Hobby: ~$5/mes. Suficiente para piloto.
- Claude Haiku es el modelo más barato (~$0.25/MTok input). Correcto para el bot.
- Sin Redis, sin workers separados — un solo servicio reduce costos.
- Vercel Hobby es gratis para uso personal/piloto.
