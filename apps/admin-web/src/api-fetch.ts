/** Send the host-only Platform session cookie on Admin API requests. */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return globalThis.fetch(input, { ...init, credentials: 'include' });
}
