// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
    ExqRFRequest,
    ExqRFResponse,
    ExqTextSearchRequest,
    ExqImageSearchRequest,
    ExqTemporalSearchRequest,
    ExqTemporalSearchResponse,
    ExqQueryRewriteRequest,
} from '@/types/exq'
import type { ExqSearchResponse, ExqQueryRewriteResponse } from '@/types/chat'
import { exqHeaders, mock, post } from './http'
import { logEvent } from './researchLog'
import { doURF as mockDoURF } from './MockExquisitorAPI'

// Separate service — different host from the main Exquisitor server
const queryRewriteURI = 'http://mandla-1:5001'

export const searchRF = async (req: ExqRFRequest): Promise<ExqRFResponse> => {
    if (mock) return mockDoURF(req)
    return post('/exq/search/rf', req)
}

export const searchText = async (req: ExqTextSearchRequest): Promise<ExqSearchResponse> => {
    if (mock) {
        if (req.text === 'test') return { suggestions: [33, 15, 20, 22] }
        else return { suggestions: [21, 59, 68, 25, 99] }
    }
    // Destructure so search_model is not sent to the server
    const { search_model, ...body } = req
    let path = '/exq/search/clip'
    if (search_model === 'caption') path = '/exq/search/caption'
    else if (search_model === 'aggregate') path = '/exq/search/aggregate'
    console.log('Search object', body)
    // First Phase 3 slice: the implemented CLIP/text endpoints. Other search
    // families remain on the legacy logger until their producers are migrated.
    if (path !== '/exq/search/clip' && path !== '/exq/search/text') return post(path, body)
    const headers = exqHeaders()
    const requestId = headers['X-Exq-Request-Id']
    const submission = logEvent('query_submission', 'search', {
        request_id: requestId,
        endpoint: path,
        request: body,
    })
    if (submission) headers['X-Exq-Event-Sequence'] = String(submission.sequence)
    try {
        const result = await post<ExqSearchResponse>(path, body, undefined, headers)
        logEvent('query_response_received', 'search', {
            request_id: requestId,
            collection: body.session_info.collection,
            model_id: body.session_info.modelId,
            suggestions: result.suggestions,
        })
        return { ...result, request_id: requestId }
    } catch (error) {
        logEvent('error', 'search', {
            request_id: requestId,
            endpoint: path,
            message: error instanceof Error ? error.message : String(error),
        })
        throw error
    }
}

export const searchImage = async (req: ExqImageSearchRequest): Promise<ExqSearchResponse> => {
    const { search_model, ...body } = req
    return post('/exq/search/image', body)
}

export const searchTemporal = async (req: ExqTemporalSearchRequest): Promise<ExqTemporalSearchResponse> => {
    if (mock) return {
        // The first two chains share a video so it shows up twice
        suggestions: [
            { group: 1, items: [1, 2, 3], length: 3, score: 0.9, start_ms: 4000, end_ms: 19000 },
            { group: 1, items: [7, 8, 9], length: 3, score: 0.8, start_ms: 61000, end_ms: 75000 },
            { group: 2, items: [21, 22], length: 2, score: 0.6, start_ms: 0, end_ms: 9000 },
            { group: 3, items: [40, 42, 45], length: 3, score: 0.5, start_ms: 120000, end_ms: 138000 },
        ]
    }
    return post('/exq/search/temporal', req)
}

export const searchQueryRewrite = async (req: ExqQueryRewriteRequest): Promise<ExqQueryRewriteResponse> => {
    if (mock) return { userQuery: req.query, positive: req.positive, rewriteSuggestion: 'textual response' }
    const resp: string = await fetch(queryRewriteURI + '/rewriteQuery', {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    }).then(val => val.json())
    // Fire-and-forget log to Exquisitor server
    post('/rewriteQueryLog', { query: req.query, positive: req.positive, caption: resp })
    return { userQuery: req.query, positive: req.positive, rewriteSuggestion: resp }
}
