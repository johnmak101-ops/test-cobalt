/**
 * Legacy entry for offline local CSVs. Prefer:
 *   pnpm --filter backend ports:sync
 *   npx tsx src/db/sync-ports.ts [unlocode.csv] [airports.csv]
 *
 * Delegates to PortsSyncService (same MERGE path as Nest monthly sync, #159).
 */
import './sync-ports.js'
