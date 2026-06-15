/** Open a milestone's source email in a standalone browser window (full body + attachments). */
export function openEmailWindow(messageId: string): void {
  const url = `/emails/view?messageId=${encodeURIComponent(messageId)}`
  window.open(url, '_blank', 'noopener,noreferrer,width=920,height=900')
}
