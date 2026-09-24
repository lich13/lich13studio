/** Apply platform identity last, including SDK retries and caller-supplied headers. */
export function providerFetch(apiHost: string, identity: Record<string, string>, fetcher: typeof fetch): typeof fetch {
  const endpoint = apiHost.endsWith('#') ? apiHost.slice(0, -1) : undefined
  return async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    for (const key of ['user-agent', 'originator', 'version', 'x-grok-client-version', 'x-grok-client-identifier'])
      headers.delete(key)
    for (const [key, value] of Object.entries(identity)) headers.set(key, value)
    const target = endpoint && input instanceof Request ? new Request(endpoint, input) : endpoint || input
    return fetcher(target, { ...init, headers })
  }
}
