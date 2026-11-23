<!-- SPDX-FileCopyrightText: 2026 Ujjwal Sharma and Omar Shahbaz Khan -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <!-- Recorded sessions (research-workspace D32): nothing is logged unless this is on,
       and while it is, it shows, with how long it has been recording -->
  <v-btn
   data-eid="record_btn"
   :color="recordingState.on ? 'red' : undefined"
   :variant="recordingState.on ? 'flat' : 'outlined'"
   size="small"
   class="mr-2"
   :aria-pressed="recordingState.on"
   @click="toggle"
  >
    <v-icon start :icon="recordingState.on ? 'mdi-stop' : 'mdi-record'" :color="recordingState.on ? undefined : 'red'" />
    {{ recordingState.on ? `REC ${elapsed}` : 'Record' }}
  </v-btn>
</template>

<script lang="ts" setup>
import { computed, onUnmounted, ref } from 'vue'
import { recordingState } from '@/services/recording'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const now = ref(Date.now())
const timer = setInterval(() => { now.value = Date.now() }, 1000)
onUnmounted(() => clearInterval(timer))

const elapsed = computed(() => {
  const seconds = Math.max(0, Math.floor((now.value - recordingState.startedAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})

function toggle() {
  if (recordingState.on) appStore.stopRecording()
  else appStore.startRecording()
}
</script>
