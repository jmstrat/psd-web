// Message types sent between main thread <-> worker thread
export const Messages = Object.freeze({
  READY: "ready",
  PROCESS: "process",
  GET_PHASE_PROFILE: "get_phase_profile",
  GET_SINGLE_PHASE: "get_single_phase",
  RESULT: "result",
  SINGLE_PHASE_RESULT: "single_phase_result",
  PHASE_PROFILE_RESULT: "phase_profile_result",
  PROGRESS: "progress",
  ERROR: "error",
  CANCEL: "cancel"
})
