const tokenCache = new Map<string, Promise<string | undefined>>()

export function resetProxyTokenCache() {
  tokenCache.clear()
}

/**
 * Fetches the shared proxy token from the same-origin Node server. The token
 * is intentionally not baked into the public bundle: it is read at runtime so
 * changing PROXY_TOKEN does not require a rebuild. Failures are non-fatal —
 * the caller proceeds without the header and the proxy responds 401 if it
 * actually requires a token.
 */
export function fetchProxyToken(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  const cached = tokenCache.get(url)
  if (cached) {
    return cached
  }

  const pending = loadProxyToken(url, fetcher)
  tokenCache.set(url, pending)
  return pending
}

async function loadProxyToken(
  url: string,
  fetcher: typeof fetch,
): Promise<string | undefined> {
  try {
    const timeoutSignal = createTimeoutSignal(5000)
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      ...(timeoutSignal ? { signal: timeoutSignal } : {}),
    })

    if (!response.ok) {
      return undefined
    }

    const body: unknown = await response.json()
    if (isRecord(body) && typeof body.token === 'string' && body.token) {
      return body.token
    }
    return undefined
  } catch {
    // Do not cache transient failures: a later request may succeed once the
    // server is reachable, while a genuine 404 (no token configured) is cached.
    tokenCache.delete(url)
    return undefined
  }
}

function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  const timeout = (
    AbortSignal as unknown as { timeout?: (milliseconds: number) => AbortSignal }
  ).timeout
  return typeof timeout === 'function' ? timeout(timeoutMs) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
