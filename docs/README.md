# ShipTrack documentation

| Role | Read |
|------|------|
| New engineer | [../README.md](../README.md) |
| Coding agent | [../AGENTS.md](../AGENTS.md) |
| API consumer (IT, chatbot, cobalt-queue) | [reference/api.md](reference/api.md) |
| Customer DEMO | [demo/DEMO-SCRIPT.md](demo/DEMO-SCRIPT.md) |
| Docker / deploy | [ops/docker-deploy.md](ops/docker-deploy.md) |
| Product | [prd/mvp_shiptrack_prd.md](prd/mvp_shiptrack_prd.md) |

## Reference

| Doc | Covers |
|-----|--------|
| [reference/api.md](reference/api.md) | Every REST endpoint, auth, roles, error codes, the agent contract |
| [reference/erp-export-api.md](reference/erp-export-api.md) | PO-grained export feed for the Mesh ERP + the "where is PO X?" chatbot |
| [reference/critic-review.md](reference/critic-review.md) | The agent's advisory assessment and how the review desk renders it |
| [reference/alert-rules-and-messages.md](reference/alert-rules-and-messages.md) | Alert thresholds, severity, and the live operator message |
| [reference/sql-server-gotchas.md](reference/sql-server-gotchas.md) | T-SQL idioms and the Postgres habits that break here |
| [reference/po-item-style-enrichment.md](reference/po-item-style-enrichment.md) | How a PO's Item/Style is merged and backfilled |
| [../backend/.env.example](../backend/.env.example) | Every backend environment variable and its default |

## Layout

| Folder | Contents |
|--------|----------|
| [reference/](reference/) | The tables above — how a shipped thing behaves |
| [ops/](ops/) | Docker deploy, the booking-ingestion gap |
| [architecture/](architecture/) | Completed ADRs / migration diary |
| [demo/](demo/) | Gold 5-spine walkthrough |
| [prd/](prd/) | PRD |
| [diagrams/](diagrams/) | SVG flows + mockups |

Upstream agent docs live in **cobalt-queue** `docs/`. Open and deferred work is in [../TODO.md](../TODO.md).
