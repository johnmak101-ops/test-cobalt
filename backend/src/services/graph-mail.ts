/**
 * Microsoft Graph API Mail Client
 *
 * Handles OAuth2 client credentials flow and mailbox access
 * via the Microsoft Graph API v1.0.
 *
 * Required Azure AD (Entra ID) app permissions:
 *   - Mail.Read (Application type)
 *
 * The client credentials flow accesses mail on behalf of the application,
 * so we need to specify a user principal name (email) to read their inbox.
 */

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface GraphConfig {
  tenantId: string
  clientId: string
  clientSecret: string
  mailboxEmail: string | null
}

export interface TokenResult {
  accessToken: string
  expiresIn: number // seconds until expiry
  expiresAt: Date
}

interface GraphEmailAddress {
  name?: string
  address?: string
}

interface GraphMessage {
  id: string
  subject?: string
  from?: {
    emailAddress?: GraphEmailAddress
  }
  sender?: {
    emailAddress?: GraphEmailAddress
  }
  receivedDateTime?: string
  body?: {
    contentType?: string
    content?: string
  }
  bodyPreview?: string
  internetMessageId?: string
}

export interface SyncResult {
  synced: number
  skipped: number
  errors: string[]
}

// ──────────────────────────────────────────────
// OAuth2 Token
// ──────────────────────────────────────────────

/**
 * Obtain an access token via the OAuth2 client credentials flow.
 * POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
 */
export async function getAccessToken(config: GraphConfig): Promise<TokenResult> {
  const url = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Failed to obtain access token: ${res.status} — ${error}`)
  }

  const data: any = await res.json()
  const expiresAt = new Date(Date.now() + (data.expires_in as number) * 1000)

  return {
    accessToken: data.access_token as string,
    expiresIn: data.expires_in as number,
    expiresAt,
  }
}

// ──────────────────────────────────────────────
// Graph API Calls
// ──────────────────────────────────────────────

/**
 * List user principal names in the tenant.
 * Used to auto-detect which mailbox to monitor.
 */
export async function listUsers(
  accessToken: string,
  tenantId: string
): Promise<Array<{ id: string; displayName: string; mail: string; userPrincipalName: string }>> {
  const url = `https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName&$top=20`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Failed to list users: ${res.status} — ${error}`)
  }

  const data: any = await res.json()
  return data.value ?? []
}

/**
 * Fetch recent messages from the specified mailbox's inbox.
 * Filters by receivedDateTime if `since` is provided.
 */
export async function fetchMessages(
  accessToken: string,
  mailboxEmail: string,
  since?: Date
): Promise<GraphMessage[]> {
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/mailFolders/inbox/messages`
    + `?$orderby=receivedDateTime desc`
    + `&$top=50`
    + `&$select=subject,from,sender,receivedDateTime,body,bodyPreview,internetMessageId`

  if (since) {
    const isoDate = since.toISOString()
    url += `&$filter=receivedDateTime gt ${isoDate}`
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Failed to fetch messages: ${res.status} — ${error}`)
  }

  const data: any = await res.json()
  return (data.value ?? []) as GraphMessage[]
}

/**
 * Validate the connection by obtaining a token and optionally
 * trying to read the mailbox.
 * Returns detected mailbox info if mailboxEmail is not set.
 */
export async function testConnection(config: GraphConfig): Promise<{
  success: boolean
  message: string
  detectedMailbox?: string
  userCount?: number
}> {
  try {
    const token = await getAccessToken(config)

    // Try to list users to verify Mail.Read permission
    const users = await listUsers(token.accessToken, config.tenantId)

    if (users.length === 0) {
      return { success: false, message: 'No users found in the tenant.' }
    }

    // If mailboxEmail is set, try to read the inbox
    const targetEmail = config.mailboxEmail || users[0]?.mail || users[0]?.userPrincipalName
    if (!targetEmail) {
      return { success: false, message: 'Could not determine mailbox email address.' }
    }

    // Try fetching 1 message to verify mailbox access
    await fetchMessages(token.accessToken, targetEmail)

    return {
      success: true,
      message: `Connected successfully. Found ${users.length} user(s) in the tenant.`,
      detectedMailbox: targetEmail,
      userCount: users.length,
    }
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Unknown error',
    }
  }
}

// ──────────────────────────────────────────────
// Message Transformation
// ──────────────────────────────────────────────

export interface ProcessEmailInput {
  subject: string
  sender: string
  bodyText: string
  bodyHtml?: string
  receivedAt: Date
  messageId?: string
}

/**
 * Transform a Graph API message into the pipeline's input format.
 */
export function transformMessage(msg: GraphMessage): ProcessEmailInput {
  const sender = msg.from?.emailAddress?.address
    || msg.sender?.emailAddress?.address
    || 'unknown@unknown.com'

  const bodyText = msg.body?.contentType === 'text'
    ? (msg.body?.content || msg.bodyPreview || '')
    : (msg.bodyPreview || '') // For HTML body, use preview as fallback

  const bodyHtml = msg.body?.contentType === 'html'
    ? msg.body?.content
    : undefined

  return {
    subject: msg.subject || '(No Subject)',
    sender,
    bodyText,
    bodyHtml,
    receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
    messageId: msg.internetMessageId || msg.id,
  }
}