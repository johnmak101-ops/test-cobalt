import { Injectable, Logger } from '@nestjs/common'

/** What "view original" returns — either the fetched email, or why it isn't available. */
export interface OriginalEmail {
  available: boolean
  source: 'graph' | 'corpus' | 'unconfigured' | 'error'
  messageId: string
  sourceFile?: string | null
  subject?: string | null
  from?: string | null
  receivedDateTime?: string | null
  bodyPreview?: string | null
  webLink?: string | null
  hasAttachments?: boolean
}

/** Map a Graph `message` resource to our DTO (pure — unit-tested). */
export function mapGraphMessage(messageId: string, m: Record<string, any>): OriginalEmail {
  return {
    available: true,
    source: 'graph',
    messageId,
    subject: m.subject ?? null,
    from: m.from?.emailAddress?.address ?? m.from?.emailAddress?.name ?? null,
    receivedDateTime: m.receivedDateTime ?? null,
    bodyPreview: m.bodyPreview ?? null,
    webLink: m.webLink ?? null,
    hasAttachments: !!m.hasAttachments,
  }
}

/**
 * Minimal Microsoft Graph client for "view original" — client-credentials token + a single
 * message fetch (headers + preview, never the full body). VM1 hosts the Graph-facing poller, so
 * the same GRAPH_* creds are available here; the feature degrades gracefully when they are not set.
 */
@Injectable()
export class GraphService {
  private readonly log = new Logger('GraphService')
  private token: { value: string; exp: number } | null = null

  private cfg() {
    return {
      tenant: process.env.GRAPH_TENANT_ID ?? '',
      clientId: process.env.GRAPH_CLIENT_ID ?? '',
      secret: process.env.GRAPH_CLIENT_SECRET ?? '',
      mailbox: process.env.GRAPH_MAILBOX ?? '',
    }
  }

  configured(): boolean {
    const c = this.cfg()
    return !!(c.tenant && c.clientId && c.secret && c.mailbox)
  }

  private async accessToken(now = Date.now()): Promise<string> {
    if (this.token && this.token.exp > now + 60_000) return this.token.value
    const c = this.cfg()
    const body = new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    })
    const res = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`graph token ${res.status}`)
    const j = (await res.json()) as { access_token: string; expires_in: number }
    this.token = { value: j.access_token, exp: now + j.expires_in * 1000 }
    return j.access_token
  }

  /** Fetch one message's headers + preview from Graph. Throws on transport/auth failure. */
  async fetchMessage(messageId: string): Promise<OriginalEmail> {
    const c = this.cfg()
    const token = await this.accessToken()
    const select = 'subject,from,receivedDateTime,bodyPreview,webLink,hasAttachments'
    const url =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.mailbox)}` +
      `/messages/${encodeURIComponent(messageId)}?$select=${select}`
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`graph message ${res.status}`)
    return mapGraphMessage(messageId, (await res.json()) as Record<string, any>)
  }
}
