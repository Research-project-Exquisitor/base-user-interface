// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { recordResearchEvent } from './researchLog'
import type { ExqSubmissionRequest, ExqSubmissionResult } from '@/types/exq'
import { mock, post } from './http'

export const submitAnswer = async (req: ExqSubmissionRequest, context?: { requestId?: string; itemId?: number; surface?: string }): Promise<ExqSubmissionResult> => {
    console.log('EvalId:', req.evalId)
    // The verdict isn't logged yet: our fork has no DRES submit route
    recordResearchEvent('answer_submission', 'answer', { request: req, item_id: context?.itemId, surface: context?.surface }, context?.requestId)
    if (mock) return { status: true, submission: 'MOCK', description: 'Mock mode: submission was not sent.' }
    // Server wraps the result as { response: {...} }; accept an unwrapped body too
    const body = await post<{ response?: ExqSubmissionResult } & Partial<ExqSubmissionResult>>('/dres/submit', req)
    return body.response ?? (body as ExqSubmissionResult)
}
