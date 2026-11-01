import { recordResearchEvent } from './researchLog'
// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ExqSubmissionRequest, ExqSubmissionResult } from '@/types/exq'
import { mock, post } from './http'

export const submitAnswer = async (req: ExqSubmissionRequest, context?: { requestId?: string; itemId?: number; surface?: string }): Promise<ExqSubmissionResult> => {
    recordResearchEvent('answer_submission', 'answer', { request: req, item_id: context?.itemId, surface: context?.surface, mode: req.evalId ? 'evaluation' : 'local' }, context?.requestId)
    if (!req.evalId) return { status: true, submission: 'CAPTURED', description: 'Answer captured for research logging. No evaluation verdict is available.' }
    if (mock) return { status: true, submission: 'MOCK', description: 'Mock mode: submission was not sent.' }
    // Server wraps the result as { response: {...} }; accept an unwrapped body too
    const body = await post<{ response?: ExqSubmissionResult } & Partial<ExqSubmissionResult>>('/dres/submit', req)
    return body.response ?? (body as ExqSubmissionResult)
}
