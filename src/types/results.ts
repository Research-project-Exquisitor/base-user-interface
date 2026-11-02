// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
/** A result page retains the search that produced its ordered IDs. */
export interface ResultPage { requestId?: string; ids: number[] }
export const resultIds = (pages: ResultPage[]): number[] => pages.flatMap(page => page.ids)
export const resultRequestId = (pages: ResultPage[], id: number): string | undefined =>
  pages.find(page => page.ids.includes(id))?.requestId
