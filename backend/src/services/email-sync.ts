/**
 * Email Sync Orchestrator
 *
 * Coordinates fetching emails from Microsoft Graph API
 * and running them through the existing email processing pipeline.
 */

import { eq } from 'drizzle-orm'
import { emailIntegrations, shippingEmails } from '../db/schema.js'
import {
  getAccessToken,
  fetchMessages,
  transformMessage,
  testConnection,
  type GraphConfig,
  type SyncResult,
} from './graph-mail.js'
import { processEmail } from './pipeline.js'

/**
 * Run a full email sync: authenticate, fetch new messages,
 * process them through the pipeline, and update the config.
 */
export async function runEmailSync(db: any): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, skipped: 0, errors: [] }

  // Load config
  const config = await db.select().from(emailIntegrations).get()
  if (!config) {
    result.errors.push('No email integration configured')
    return result
  }

  if (!config.tenantId || !config.clientId || !config.clientSecret) {
    result.errors.push('Missing required Graph API credentials')
    return result
  }

  const graphConfig: GraphConfig = {
    tenantId: config.tenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    mailboxEmail: config.mailboxEmail,
  }

  try {
    // Step 1: Get access token
    const token = await getAccessToken(graphConfig)

    const mailboxEmail = config.mailboxEmail
    if (!mailboxEmail) {
      result.errors.push('Mailbox email not configured. Run "Test Connection" first.')
      await updateSyncStatus(db, config.id, 'FAILED', 'Mailbox email not configured', 0)
      return result
    }

    // Step 2: Fetch messages since last sync
    const since = config.lastSyncAt ? new Date(config.lastSyncAt) : undefined
    const messages = await fetchMessages(token.accessToken, mailboxEmail, since)

    console.log(`[EmailSync] Fetched ${messages.length} messages from ${mailboxEmail}`)

    // Step 3: Process each message
    for (const msg of messages) {
      try {
        // Dedup: check if we already processed this message
        const messageId = msg.internetMessageId || msg.id
        if (messageId) {
          const existing = await db
            .select()
            .from(shippingEmails)
            .where(eq(shippingEmails.messageId, messageId))
            .get()

          if (existing) {
            result.skipped++
            continue
          }
        }

        // Transform and process
        const input = transformMessage(msg)
        await processEmail(db, input)
        result.synced++
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        result.errors.push(`Failed to process message "${msg.subject}": ${errorMsg}`)
        console.error(`[EmailSync] Error processing message:`, errorMsg)
      }
    }

    // Step 4: Update sync status
    const status = result.errors.length === 0 ? 'SUCCESS' : result.synced > 0 ? 'PARTIAL' : 'FAILED'
    await updateSyncStatus(db, config.id, status, result.errors.join('; ') || null, result.synced)

    console.log(
      `[EmailSync] Sync complete: ${result.synced} synced, ${result.skipped} skipped, ${result.errors.length} errors`
    )
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    result.errors.push(`Sync failed: ${errorMsg}`)
    console.error(`[EmailSync] Fatal error:`, errorMsg)

    await updateSyncStatus(db, config.id, 'FAILED', errorMsg, 0)
  }

  return result
}

/**
 * Test the Graph API connection and auto-detect the mailbox.
 */
export async function testGraphConnection(db: any): Promise<{
  success: boolean
  message: string
  detectedMailbox?: string
  userCount?: number
}> {
  const config = await db.select().from(emailIntegrations).get()
  if (!config) {
    return { success: false, message: 'No email integration configured yet.' }
  }

  const graphConfig: GraphConfig = {
    tenantId: config.tenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    mailboxEmail: config.mailboxEmail,
  }

  const result = await testConnection(graphConfig)

  // If a mailbox was detected and config doesn't have one, update it
  if (result.success && result.detectedMailbox && !config.mailboxEmail) {
    await db
      .update(emailIntegrations)
      .set({ mailboxEmail: result.detectedMailbox, updatedAt: new Date() })
      .where(eq(emailIntegrations.id, config.id))
  }

  return result
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

async function updateSyncStatus(
  db: any,
  configId: string,
  status: string,
  error: string | null,
  count: number
) {
  await db
    .update(emailIntegrations)
    .set({
      lastSyncAt: new Date(),
      lastSyncStatus: status,
      lastSyncError: error,
      lastSyncCount: count,
      updatedAt: new Date(),
    })
    .where(eq(emailIntegrations.id, configId))
}