import { useState, useEffect } from 'react'
import { Card } from '../ui/Card'
import { cn } from '../../lib/utils'
import {
  useEmailIntegration,
  useSaveEmailIntegration,
  useTestEmailConnection,
  useSyncEmails,
} from '../../hooks/use-email-integrations'
import { RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronRight, Zap } from 'lucide-react'

export function EmailIntegrationSettings() {
  const { data, isLoading } = useEmailIntegration()
  const saveConfig = useSaveEmailIntegration()
  const testConnection = useTestEmailConnection()
  const syncEmails = useSyncEmails()

  const config = data?.config ?? null

  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [mailboxEmail, setMailboxEmail] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  // Populate form from config when loaded
  useEffect(() => {
    if (config) {
      setTenantId(config.tenantId ?? '')
      setClientId(config.clientId ?? '')
      setClientSecret('') // Leave blank; masked value is not the real secret
      setMailboxEmail(config.mailboxEmail ?? '')
      setIsActive(config.isActive)
    }
  }, [config])

  const handleSave = () => {
    const payload: Record<string, unknown> = {
      tenantId,
      clientId,
      mailboxEmail: mailboxEmail || null,
      isActive,
    }
    // Only send secret if the user entered a new one
    if (clientSecret) {
      payload.clientSecret = clientSecret
    } else if (!config) {
      // First-time save requires a secret
      return
    }
    saveConfig.mutate(payload as any)
  }

  const handleTest = () => {
    // Save first if not yet saved, then test
    if (!config && tenantId && clientId && clientSecret) {
      saveConfig.mutate(
        { tenantId, clientId, clientSecret, mailboxEmail: mailboxEmail || null, isActive },
        { onSuccess: () => testConnection.mutate() }
      )
    } else {
      testConnection.mutate()
    }
  }

  const handleSync = () => {
    syncEmails.mutate()
  }

  // Relative time formatting
  const formatLastSync = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return date.toLocaleDateString()
  }

  const isConnected = config?.lastSyncStatus === 'SUCCESS' || config?.lastSyncStatus === 'PARTIAL'
  const hasError = config?.lastSyncStatus === 'FAILED'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Microsoft 365 Email Connection</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Connect to your shared mailbox to automatically import shipping emails into Cobalt Track.
        </p>
      </div>

      {/* Connection Status */}
      {config && (
        <Card>
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${isConnected ? 'bg-status-success' : hasError ? 'bg-status-critical' : 'bg-text-muted'}`} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {isConnected ? 'Connected' : hasError ? 'Connection Error' : 'Not Connected'}
                </span>
                {config.lastSyncAt && (
                  <span className="text-xs text-text-muted">
                    Last sync: {formatLastSync(config.lastSyncAt)}
                  </span>
                )}
              </div>
              {isConnected && (
                <p className="mt-0.5 text-xs text-text-secondary">
                  {config.lastSyncCount ?? 0} email{config.lastSyncCount !== 1 ? 's' : ''} synced
                </p>
              )}
              {hasError && config.lastSyncError && (
                <p className="mt-0.5 text-xs text-status-critical">{config.lastSyncError}</p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Azure AD Credentials */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">Azure AD / Entra ID Credentials</h3>
        <p className="mb-4 text-xs text-text-muted">
          Enter the credentials from your Azure App Registration. The Client Secret is masked after saving.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary">Tenant ID</label>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary">Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary">Client Secret</label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={config?._secretMasked ? '•••••••••••••• (enter new value to change)' : 'Enter client secret'}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
          </div>
        </div>
      </Card>

      {/* Mailbox Settings */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">Mailbox</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary">Email Address</label>
            <input
              type="email"
              value={mailboxEmail}
              onChange={(e) => setMailboxEmail(e.target.value)}
              placeholder="e.g. shipping@cobalt.hk"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">
              Auto-filled when you test the connection. You can also enter it manually.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">Auto-sync</p>
              <p className="text-xs text-text-muted">Polls for new emails every 5 minutes when enabled</p>
            </div>
            <button
              onClick={() => setIsActive(!isActive)}
              className={cn(
                'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                isActive ? 'bg-cobalt-primary' : 'bg-surface-600'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                  isActive ? 'left-[22px]' : 'left-0.5'
                )}
              />
            </button>
          </div>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleTest}
          disabled={testConnection.isPending || (!tenantId && !config)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          {testConnection.isPending ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Zap size={14} />
          )}
          {testConnection.isPending ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          onClick={handleSync}
          disabled={syncEmails.isPending || !config}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          {syncEmails.isPending ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {syncEmails.isPending ? 'Syncing...' : 'Sync Now'}
        </button>
        <button
          onClick={handleSave}
          disabled
          title="Graph credentials are managed in the ingestion service (graph_api), not stored in the tracking app"
          className="rounded-lg bg-cobalt-primary px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-primary-light disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
      </div>

      {/* Test / Sync result messages */}
      {testConnection.data && (
        <div className={cn(
          'flex items-start gap-2 rounded-lg border p-3 text-sm',
          testConnection.data.success
            ? 'border-status-success/30 bg-status-success/10 text-status-success'
            : 'border-status-critical/30 bg-status-critical/10 text-status-critical'
        )}>
          {testConnection.data.success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
          <div>
            <p>{testConnection.data.message}</p>
            {testConnection.data.detectedMailbox && (
              <p className="mt-1 text-xs opacity-80">
                Detected mailbox: {testConnection.data.detectedMailbox}
              </p>
            )}
          </div>
        </div>
      )}
      {testConnection.isError && (
        <div className="flex items-start gap-2 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
          <XCircle size={16} className="mt-0.5 shrink-0" />
          <p>{(testConnection.error as Error)?.message || 'Connection test failed'}</p>
        </div>
      )}
      {syncEmails.data && (
        <div className="rounded-lg border border-border bg-surface-800 p-3 text-sm text-text-secondary">
          <p>
            Sync complete: {syncEmails.data.synced} email{syncEmails.data.synced !== 1 ? 's' : ''} synced
            {syncEmails.data.skipped > 0 && `, ${syncEmails.data.skipped} skipped`}
            {syncEmails.data.errors.length > 0 && `, ${syncEmails.data.errors.length} error${syncEmails.data.errors.length !== 1 ? 's' : ''}`}
          </p>
          {syncEmails.data.errors.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-status-critical">
              {syncEmails.data.errors.slice(0, 3).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
              {syncEmails.data.errors.length > 3 && (
                <li>...and {syncEmails.data.errors.length - 3} more</li>
              )}
            </ul>
          )}
        </div>
      )}
      {saveConfig.isError && (
        <div className="flex items-start gap-2 rounded-lg border border-status-critical/30 bg-status-critical/10 p-3 text-sm text-status-critical">
          <XCircle size={16} className="mt-0.5 shrink-0" />
          <p>{(saveConfig.error as Error)?.message || 'Failed to save configuration'}</p>
        </div>
      )}
      {saveConfig.isSuccess && !testConnection.data && !syncEmails.data && (
        <div className="flex items-start gap-2 rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm text-status-success">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <p>Configuration saved successfully.</p>
        </div>
      )}

      {/* Setup Guide */}
      <div className="rounded-lg border border-border">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          <span>Setup Guide — How to configure Azure AD</span>
          {showGuide ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {showGuide && (
          <div className="border-t border-border px-4 py-3">
            <ol className="list-inside list-decimal space-y-2 text-xs text-text-secondary">
              <li>
                Go to{' '}
                <span className="font-mono text-text-primary">https://portal.azure.com</span>{' '}
                and sign in with your organizational account.
              </li>
              <li>
                Navigate to <span className="font-semibold text-text-primary">Azure Active Directory</span> →{' '}
                <span className="font-semibold text-text-primary">App registrations</span> →{' '}
                <span className="font-semibold text-text-primary">New registration</span>.
              </li>
              <li>
                Give it a name (e.g. "Cobalt Track Email Sync"), select "Accounts in this organizational directory only",
                and click <span className="font-semibold text-text-primary">Register</span>.
              </li>
              <li>
                On the app's page, copy the <span className="font-semibold text-text-primary">Application (client) ID</span>{' '}
                and <span className="font-semibold text-text-primary">Directory (tenant) ID</span> — paste them above.
              </li>
              <li>
                Go to <span className="font-semibold text-text-primary">API permissions</span> →{' '}
                <span className="font-semibold text-text-primary">Add a permission</span> →{' '}
                <span className="font-semibold text-text-primary">Microsoft Graph</span> →{' '}
                <span className="font-semibold text-text-primary">Application permissions</span> →{' '}
                search for and check <span className="font-mono text-text-primary">Mail.Read</span> →{' '}
                click <span className="font-semibold text-text-primary">Add permission</span>.
              </li>
              <li>
                Click <span className="font-semibold text-text-primary">Grant admin consent</span> for the permission.
              </li>
              <li>
                Go to <span className="font-semibold text-text-primary">Certificates & secrets</span> →{' '}
                <span className="font-semibold text-text-primary">New client secret</span> → give it a description
                and expiry → copy the <span className="font-semibold text-text-primary">Value</span> (this is your Client Secret).
              </li>
              <li>
                Paste the Client Secret above, then click <span className="font-semibold text-text-primary">Test Connection</span> to verify everything works.
              </li>
            </ol>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="text-sm text-text-muted">Loading configuration...</div>
      )}
    </div>
  )
}
