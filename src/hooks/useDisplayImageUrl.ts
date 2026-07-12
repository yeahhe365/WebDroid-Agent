import { useEffect, useMemo } from 'react'

/**
 * Prefer a blob: URL for display so large data: URLs are not re-decoded from
 * base64 on every image paint. Revokes previous blob URLs on change/unmount.
 *
 * Parsing is local (no fetch) so tests and CSP never need network for data URLs.
 */
export function useDisplayImageUrl(source: string | null | undefined): string | null {
  const displayUrl = useMemo(() => (source ? toDisplayUrl(source) : null), [source])

  useEffect(() => {
    return () => {
      if (displayUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(displayUrl)
      }
    }
  }, [displayUrl])

  return displayUrl
}

function toDisplayUrl(source: string): string {
  if (!source.startsWith('data:')) {
    return source
  }
  return dataUrlToObjectUrl(source)
}

function dataUrlToObjectUrl(dataUrl: string): string {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return dataUrl
  }

  try {
    const commaIndex = dataUrl.indexOf(',')
    if (commaIndex < 0) {
      return dataUrl
    }

    const meta = dataUrl.slice(5, commaIndex)
    const payload = dataUrl.slice(commaIndex + 1)
    const mime = meta.split(';')[0] || 'application/octet-stream'
    const isBase64 = /;base64/i.test(meta)

    let bytes: Uint8Array
    if (isBase64) {
      const binary = atob(payload)
      bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload))
    }

    return URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mime }))
  } catch {
    return dataUrl
  }
}
