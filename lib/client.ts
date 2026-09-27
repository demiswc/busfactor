'use client'
/** Small fetch helper for client components. */
export async function api<T = Record<string, unknown>>(path: string, method: 'GET' | 'POST' | 'PUT' = 'POST', payload?: unknown) {
  try {
    const r = await fetch(path, {
      method,
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      credentials: 'same-origin',
    })
    const data = (await r.json().catch(() => ({}))) as T & { error?: string; message?: string }
    return { ok: r.ok && (data as { ok?: boolean }).ok !== false, status: r.status, data, error: data.error || (!r.ok ? data.message || 'Something went wrong.' : undefined) }
  } catch {
    return { ok: false, status: 0, data: {} as T & { error?: string; message?: string }, error: 'Could not reach the server. Check your connection.' }
  }
}
