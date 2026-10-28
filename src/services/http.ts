// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later

export const exqURI = 'https://localhost:5000'
export const mock = false

export const getMainURI = () => exqURI

let sessionId = ''

/** Session ID sent with every request, so the server's log lines show it. */
export const setSessionId = (id: string): void => {
    sessionId = id
}

export const getSessionId = (): string => sessionId

/** A short random ID per request; the server tags its log lines with it. */
function newRequestId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Headers for every request to the engine. */
export function exqHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Exq-Request-Id': newRequestId(),
    }
    if (sessionId) headers['X-Exq-Session'] = sessionId
    return headers
}

export class HttpError extends Error {
    constructor(
        message: string,
        public readonly method: string,
        public readonly url: string,
        public readonly body?: unknown,
    ) {
        super(message)
        this.name = 'HttpError'
    }
}

async function checkResponse(resp: Response, method: string, body?: unknown): Promise<void> {
    if (!resp.ok) {
        let responseText = ''
        try { responseText = await resp.text() } catch { /* ignore */ }
        const msg = `HTTP ${resp.status} ${resp.statusText}${responseText ? `: ${responseText}` : ''}`
        throw new HttpError(msg, method, resp.url, body)
    }
}

export async function post<T>(path: string, body: unknown, signal?: AbortSignal, headers = exqHeaders()): Promise<T> {
    const resp = await fetch(exqURI + path, {
        method: 'POST',
        mode: 'cors',
        headers,
        body: JSON.stringify(body),
        signal,
    })
    await checkResponse(resp, 'POST', body)
    return resp.json()
}

export async function get<T>(path: string): Promise<T> {
    const resp = await fetch(exqURI + path, {
        method: 'GET',
        mode: 'cors',
        headers: exqHeaders(),
    })
    await checkResponse(resp, 'GET')
    return resp.json()
}
