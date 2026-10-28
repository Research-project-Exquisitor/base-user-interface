// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later

// Keep in sync with live-services-engine/app/schemas/logging.py.
// Update both definitions together when the research event contract changes.
export type EventType =
  | 'session_start' | 'session_end'
  | 'query_submission' | 'query_execution' | 'query_response_received'
  | 'result_state' | 'result_click' | 'relevance_label'
  | 'display_change' | 'visibility_change' | 'filter_change'
  | 'video_play' | 'video_seek' | 'back_navigation'
  | 'answer_submission' | 'error'

export type EventTarget = 'session' | 'search' | 'result' | 'results' | 'filter' | 'video' | 'answer'

export interface LogEvent {
  type: EventType
  target: EventTarget
  source: 'client' | 'server'
  time: { client?: number | null; server?: number | null }
  sequence: number
  request_id?: string | null
  session_id: string
  user_id?: string | null
  task_id?: string | null
  event_id?: string
  v?: 1
  data?: Record<string, unknown>
}

// Every event produced by the UI has an ID and a client timestamp.
export type ClientLogEvent = LogEvent & {
  source: 'client'
  time: { client: number }
  event_id: string
  v: 1
  data: Record<string, unknown>
}
