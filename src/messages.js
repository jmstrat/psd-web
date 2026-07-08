// Message types sent between main thread <-> worker thread
export const Messages = Object.freeze({
  READY: "ready",

  IMPORT_AND_RUN_PSD: "import_run_psd",
  GET_AVERAGED_PERIOD: "get_averaged_period",
  GET_PHASE_PROFILE: "get_phase_profile",
  GET_SINGLE_PHASE: "get_single_phase",

  PSD_RESULT: "psd_result",
  AVERAGED_PERIOD_RESULT: "averaged_period_result",
  SINGLE_PHASE_RESULT: "single_phase_result",
  PHASE_PROFILE_RESULT: "phase_profile_result",
  PROGRESS: "progress",
  ERROR: "error",
  CANCEL: "cancel"
})

export const ProgressStage = Object.freeze({
  READING: 'read',
  CALCULATING: 'calculate',
  FINISHED: 'finished'
})
