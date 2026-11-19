// SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Router } from 'vue-router'
import { recordResearchEvent } from './researchLog'

/** The browser's back and forward buttons (and history gestures), as
 * `back_navigation`. The router's history listener only fires for those, not
 * for navigation the app does itself (e.g. Home → Search), which the app's
 * own events already describe. Going back from Search to Home leaves the
 * search screen, so a replay needs to know it happened.
 */
export function installNavigationLogging(router: Router): void {
  router.options.history.listen((to, from, info) => {
    recordResearchEvent('back_navigation', 'session', {
      direction: info.direction || null,
      delta: info.delta,
      from,
      to,
    })
  })
}
