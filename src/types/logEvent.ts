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
  v?: 1
  event_id?: string
  source: 'client' | 'server'
  user_id?: string | null
  session_id: string
  task_id?: string | null
  time: { client?: number | null; server?: number | null }
  sequence: number
  type: EventType
  target: EventTarget
  data?: Record<string, unknown>
}

// Every event produced by the UI has an ID and a client timestamp.
export type ClientLogEvent = LogEvent & {
  v: 1
  event_id: string
  source: 'client'
  time: { client: number }
  data: Record<string, unknown>
}
