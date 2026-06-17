/** Open a milestone's / review email's source email in a standalone popup WINDOW (Outlook/O365
 *  reading-pane style) — full body + downloadable attachments. We deliberately do NOT pass
 *  `noopener` here: with it, Chrome ignores the width/height and opens a plain TAB instead of a
 *  sized window. We null `opener` afterwards to keep the same isolation. A per-message window name
 *  means re-opening the same email focuses its existing window rather than spawning duplicates. */
export function openEmailWindow(messageId: string): void {
  const url = `/emails/view?messageId=${encodeURIComponent(messageId)}`
  const w = 1040
  const h = 920
  const baseLeft = window.screenLeft ?? window.screenX ?? 0
  const baseTop = window.screenTop ?? window.screenY ?? 0
  const outerW = window.outerWidth || window.innerWidth || w
  const outerH = window.outerHeight || window.innerHeight || h
  const left = Math.round(baseLeft + Math.max(0, (outerW - w) / 2))
  const top = Math.round(baseTop + Math.max(0, (outerH - h) / 2))
  const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
  const name = `cobalt-email-${messageId.replace(/[^a-z0-9]/gi, '_')}`
  const win = window.open(url, name, features)
  if (win) win.opener = null
}
