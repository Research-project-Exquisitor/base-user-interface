// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import { newSessionId, resumeRecording } from './recording'
import type { ExqInitResponse } from '@/types/exq'
import { exqURI, get, mock, setSessionId } from './http'
import {
    initSession as mockInitExq,
} from './MockExquisitorAPI'

export const initSession = async (): Promise<ExqInitResponse> => {
    if (mock) return mockInitExq()
    // A recording this tab started continues after a reload (logs page_start);
    // otherwise the session is unrecorded until the Record button starts one (D32)
    const session = resumeRecording() ?? newSessionId()
    setSessionId(session)
    const resp = await get<{ session: string; collections: string[] }>(
        '/exq/init/' + session
    )
    setSessionId(resp.session)
    // DRES is a separate evaluation service — fetched separately on init
    const evals: { id: string; name: string }[] = await fetch(exqURI + '/dres/evaluation_list/')
        .then(val => val.status !== 404 ? val.json() : [])
    return {
        session: resp.session,
        collections: resp.collections,
        evaluations: evals,
    }
}

// TODO: endpoint not yet defined
export const getCollections = async (): Promise<string[]> =>
    get('/CALL_TO_API_HERE')
