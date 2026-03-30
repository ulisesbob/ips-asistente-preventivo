# IPS Asistente Preventivo — SRE Reliability Document

## System Context

Pilot healthcare assistant for IPS Misiones. Hundreds of patients. Single-instance Railway deployment. No redundancy by design — budget and scale do not justify it.

---

## 1. Service Level Indicators (SLIs)

### API (Railway)
| SLI | Source |
|-----|--------|
| Availability — % of /health returning 200 | UptimeRobot (free, 5-min interval) |
| Request success rate — % of non-5xx responses | Railway logs |
| Auth p95 latency | Railway logs |
| CRUD p95 latency | Railway logs |
| Cron execution — completed without error | Railway logs + Healthchecks.io |

### Panel (Vercel)
| SLI | Source |
|-----|--------|
| Panel availability | UptimeRobot |
| Function error rate | Vercel function logs |

### WhatsApp Bot
| SLI | Source |
|-----|--------|
| Webhook availability — % of 200 responses within 5s | Railway logs |
| AI response success — % of messages with Claude response | Railway logs |
| Bot response p95 latency | Railway logs |

### Daily Cron (8AM)
| SLI | Source |
|-----|--------|
| On-time execution (±10 min of 8:00 AM ART) | Healthchecks.io |
| Reminder delivery rate | Railway logs |

---

## 2. Service Level Objectives (SLOs)

### API
| SLO | Target | Window |
|-----|--------|--------|
| API availability | 95.0% | 30-day rolling |
| Request success rate | 98.0% | 7-day rolling |
| Auth p95 latency | < 2000ms | 24-hour |
| CRUD p95 latency | < 3000ms | 24-hour |

### Panel
| SLO | Target | Window |
|-----|--------|--------|
| Panel availability | 97.0% | 30-day rolling |
| Function error rate | < 3% | 7-day rolling |

### WhatsApp Bot
| SLO | Target | Window |
|-----|--------|--------|
| Webhook availability | 95.0% | 30-day rolling |
| Bot response success | 90.0% | 7-day rolling |
| Bot p95 latency | < 8000ms | 24-hour |

### Cron
| SLO | Target | Window |
|-----|--------|--------|
| Cron execution success | 95.0% | 30-day rolling |
| Reminder delivery rate | 90.0% | per-day |

---

## 3. Error Budgets

| Service | SLO | Allowed Downtime/Failures |
|---------|-----|--------------------------|
| API (95%) | 5% failure | ~36 hours/month |
| Panel (97%) | 3% failure | ~21.6 hours/month |
| Bot response (90%) | 10% failure | 1 in 10 messages may fail |
| Cron (95%) | 5% failure | ~1.5 missed runs/month |

### Error Budget Policy
- **50% consumed:** Review Railway logs, check for regressions.
- **80% consumed:** Notify tech lead. Pause non-critical deploys.
- **100% consumed (breach):** Incident summary to IPS within 48h. Feature freeze until 7 days stable. Document in LESSONS.md.

---

## 4. Alerting Strategy (Free Tools)

### Tier 1 — UptimeRobot (Free)
| Monitor | URL | Alert |
|---------|-----|-------|
| API Health | `GET [railway-url]/health` | Email |
| Panel | `GET [vercel-url]` | Email |

### Tier 2 — Railway Logs (Weekly Review)
Every Monday 9AM: filter for ERROR, 5xx, cron failed, DB connection, Claude API error.

### Tier 3 — Healthchecks.io (Free)
Cron pings after successful run. Alert if no ping by 8:30 AM ART.

### Tier 4 — Vercel Analytics (Built-in)
Enable Speed Insights. Review functions tab weekly.

---

## 5. Health Endpoints

| Endpoint | Purpose | UptimeRobot? |
|----------|---------|-------------|
| `GET /health` | Liveness check. Process alive. <200ms. | Yes |
| `GET /health/deep` | DB connectivity (`SELECT 1`). Returns 503 if failed. | No |
| `GET /health/cron` | Last cron run timestamp + result. | No |

---

## 6. Key Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Railway restart during 8AM cron | Partial reminder batch | Schedule at 8:05 AM. Healthchecks.io monitor. |
| Meta disables webhook on 5xx | Bot goes silent | UptimeRobot keeps instance warm. Never 5xx to Meta. |
| Claude Haiku outage | Bot can't respond | Static fallback: "Un profesional te contactará pronto." |
| PostgreSQL data loss | Critical | Verify Railway backup retention. Weekly manual export. |

---

## 7. Review Cadence

| Review | Frequency | Action |
|--------|-----------|--------|
| Uptime + error check | Weekly | Log error counts, check cron health |
| Error budget status | Monthly | Report SLO compliance to IPS |
| SLO target revision | Quarterly | Adjust based on pilot data |
| Postmortem | After incident > 30 min | Update LESSONS.md |
