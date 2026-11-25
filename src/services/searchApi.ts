// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
    ExqRFRequest,
    ExqRFResponse,
    ExqTextSearchRequest,
    ExqImageSearchRequest,
    ExqTemporalSearchRequest,
    ExqTemporalSearchResponse,
} from '@/types/exq'
import type { ExqSearchResponse } from '@/types/chat'
import { newRequestId, mock, post } from './http'
import { recordResearchEvent } from './researchLog'
import { doURF as mockDoURF } from './MockExquisitorAPI'

export const searchRF = async (req: ExqRFRequest): Promise<ExqRFResponse> => {
    if (mock) return mockDoURF(req)
    return postSearch('/exq/search/rf', req)
}

/** Which history entry a search creates or adds a page to (research-workspace
 * D37): `query_id`, and for a temporal search the entries it combines. */
export interface SearchContext {
    query_id?: string
    hop_query_ids?: string[]
}

export const searchText = async (req: ExqTextSearchRequest, context?: SearchContext): Promise<ExqSearchResponse> => {
    if (mock) {
        if (req.text === 'test') return { suggestions: [33, 15, 20, 22] }
        else return { suggestions: [21, 59, 68, 25, 99] }
    }
    // Destructure so search_model is not sent to the server
    const { search_model, ...body } = req
    console.log('Search object', body)
    return postSearch('/exq/search/clip', body, context)
}

// Shared event capture for migrated searches. Keep transport and correlation
// consistent across search families; unmigrated endpoints keep calling post().
async function postSearch<T extends { suggestions: unknown[] }>(
    path: string,
    body: ExqTextSearchRequest | ExqImageSearchRequest | ExqRFRequest | ExqTemporalSearchRequest,
    context: SearchContext = {},
): Promise<T & { request_id?: string }> {
    const requestId = newRequestId()
    const submission = recordResearchEvent('query_submission', 'search', {
        endpoint: path,
        request: body,
        ...context,
    }, requestId)
    try {
        const result = await post<T>(path, body, undefined, { requestId, sequence: submission?.sequence })
        recordResearchEvent('query_response_received', 'search', {
            collection: body.session_info.collection,
            model_id: body.session_info.modelId,
            suggestions: result.suggestions,
            ...context,
        }, requestId)
        return { ...result, request_id: requestId }
    } catch (error) {
        recordResearchEvent('error', 'search', {
            endpoint: path,
            message: error instanceof Error ? error.message : String(error),
        }, requestId)
        throw error
    }
}

export const searchImage = async (req: ExqImageSearchRequest, context?: SearchContext): Promise<ExqSearchResponse> => {
    const { search_model, ...body } = req
    return postSearch('/exq/search/image', body, context)
}

export const searchTemporal = async (req: ExqTemporalSearchRequest, context?: SearchContext): Promise<ExqTemporalSearchResponse> => {
    if (mock) return {
        // The first two chains share a video so it shows up twice
        suggestions: [
            { group: 1, items: [1, 2, 3], length: 3, score: 0.9, start_ms: 4000, end_ms: 19000 },
            { group: 1, items: [7, 8, 9], length: 3, score: 0.8, start_ms: 61000, end_ms: 75000 },
            { group: 2, items: [21, 22], length: 2, score: 0.6, start_ms: 0, end_ms: 9000 },
            { group: 3, items: [40, 42, 45], length: 3, score: 0.5, start_ms: 120000, end_ms: 138000 },
        ]
    }
    return postSearch('/exq/search/temporal', req, context)
}
