import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProxyToken, resetProxyTokenCache } from './proxyToken'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

afterEach(() => {
  resetProxyTokenCache()
  vi.restoreAllMocks()
})

describe('fetchProxyToken', () => {
  it('fetches the token once and caches it', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ token: 'letmein' }))

    await expect(fetchProxyToken('/api/proxy-token', fetcher)).resolves.toBe('letmein')
    await expect(fetchProxyToken('/api/proxy-token', fetcher)).resolves.toBe('letmein')

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      '/api/proxy-token',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
  })

  it('returns undefined when the server has no token configured', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({}, { status: 404 }))

    await expect(fetchProxyToken('/api/proxy-token', fetcher)).resolves.toBeUndefined()
  })

  it('retries after a transient failure instead of caching it', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ token: 'letmein' }))

    await expect(fetchProxyToken('/api/proxy-token', fetcher)).resolves.toBeUndefined()
    await expect(fetchProxyToken('/api/proxy-token', fetcher)).resolves.toBe('letmein')

    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
