import './styles.css'
import { Messages, ProgressStage } from "./messages.js"
import { StatusMessage } from "./ui/status-message.js"
import { ProgressBar } from "./ui/progress-bar.js"
import { MetadataRenderer } from "./ui/metadata-renderer.js"
import {
  destroyPSD, renderPSD,
  destroyPhaseProfile, renderPhaseProfile,
  destroySinglePhase, renderSinglePhase
} from "./charts/index.js"
import { downloadAnalysisArchive } from "./exporting/download.js"

import workerModule from './worker.js?worker'

// All calculations and file parsing are done in the worker thread
// The main thread just handles the UI (and plotting)
const worker = new workerModule()

// Header
const downloadButton = document.getElementById('downloadButton')
const helpButton = document.getElementById("helpButton")
const closeHelp = document.getElementById("closeHelp")
const helpModal = document.getElementById("helpModal")

// Upload
const fileInput = document.getElementById("fileUpload")
const fileStatus = document.getElementById("uploadStatus")
const chooseButton = document.getElementById("chooseFile")

// Analysis settings
const parametersForm = document.getElementById("parameters")
const cyclePeriodInput = document.getElementById("cyclePeriod")
const acquisitionIntervalInput = document.getElementById("acquisitionInterval")
const waveTypeInput = document.getElementById("waveType")
const harmonicInput = document.getElementById("harmonic")
const resolutionInput = document.getElementById("resolution")

const runButton = document.getElementById("runButton")

// Input Settings
const xMinInput = document.getElementById("xMin")
const xMaxInput = document.getElementById("xMax")
const sepInput = document.getElementById("input-separator")
const xColInput = document.getElementById("input-x-col")
const yColsInput = document.getElementById("input-y-cols")

let currentPsdData = null
let currentProfileData = null
let currentSinglePhaseData = null

let averagingOptions = {}
let parserOptions = {}
let processingOptions = {}

let isWorkerReady = false

const status = new StatusMessage(document.getElementById("statusBadge"))
const progress = new ProgressBar(document.getElementById('progressContainer'))
const metadata = new MetadataRenderer(document.getElementById("metadataContainer"))

function updateReadyState () {
  const hasFiles = fileInput.files && fileInput.files.length > 0

  if (!isWorkerReady) {
    runButton.disabled = true
    status.message = "Loading..."
    status.type = 'info'
    return
  }

  if (!hasFiles) {
    runButton.disabled = true
    status.message = "Please select files to begin"
    status.type = 'info'

    progress.hide()
    return
  }

  if (runButton.disabled) {
    status.message = "Please update the analysis settings"
    status.type = 'info'
    return
  }

  status.message = "Ready"
  status.type = "success"
}

function validateForm () {
  const cycle = parseFloat(cyclePeriodInput.value)
  const interval = parseFloat(acquisitionIntervalInput.value)
  const harmonic = parseFloat(harmonicInput.value)
  const resolution = parseFloat(resolutionInput.value)

  const hasFiles = fileInput.files && fileInput.files.length > 0

  const isCycleInvalid = isNaN(cycle) || cycle <= 0
  const isIntervalInvalid = isNaN(interval) || interval <= 0
  const isHarmonicInvalid = isNaN(harmonic) || harmonic < 0 || !Number.isInteger(harmonic)
  const isResolutionInvalid = isNaN(resolution) || resolution <= 0 || resolution >= 360

  const shouldDisable = isCycleInvalid ||
                        isIntervalInvalid ||
                        isHarmonicInvalid ||
                        isResolutionInvalid ||
                        !hasFiles

  runButton.disabled = shouldDisable


  if (!hasFiles) {
    fileStatus.textContent = "No files selected"
  } else {
    const plural = fileInput.files.length !== 1
    fileStatus.textContent = `${fileInput.files.length} file${plural ? 's' : ''} ready to process`
  }


  if (status.type !== 'error') {
    updateReadyState()
  }
}

function rangeToIntArray (input, diff=0) {
  const result = []

  for (const part of input.split(',')) {
    const trimmed = part.trim()

    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(Number)
      for (let i = start; i <= end; i++) {
        result.push(i + diff)
      }
    } else if (trimmed !== "") {
      result.push(Number(trimmed) + diff)
    }
  }
  return result
}

chooseButton.addEventListener("click", () => fileInput.click())
fileInput.addEventListener("change", () => {
  validateForm()
})

destroyPSD()
destroyPhaseProfile()
destroySinglePhase()

worker.onmessage = ({ data }) => {
  switch (data.type) {
    case Messages.READY:
      isWorkerReady = true
      updateReadyState()
      break
    case Messages.PROGRESS:
      progress.show()

      if (data.stage === ProgressStage.READING) {
        status.message = "Reading files..."
        status.type = 'info'
        progress.max = data.total
        progress.progress = data.current
        progress.message = `Reading ${data.current} of ${data.total}`
      } else if (data.stage === ProgressStage.CALCULATING) {
        status.message = "Processing..."
        status.type = 'info'
        progress.progress = null
      } else if (data.stage === ProgressStage.FINISHED) {
        status.message = "Finished"
        status.type = 'success'
        progress.hide()
        downloadButton.disabled = false
      }
      break
    case Messages.PSD_RESULT:
      validateForm()
      destroyPhaseProfile()
      destroySinglePhase()
      metadata.render(data.metadata)

      // Save data for downloading
      currentPsdData = data
      currentProfileData = null
      currentSinglePhaseData = null

      console.time("Plotting PSD")
      renderPSD(data, onPSDChartClick)
      console.timeEnd("Plotting PSD")
      break
    case Messages.SINGLE_PHASE_RESULT:
      validateForm()

      currentSinglePhaseData = data
      processingOptions.selectedPhase = data.targetPhase

      console.time("Plotting Single Phase")
      renderSinglePhase(data)
      console.timeEnd("Plotting Single Phase")
      break
    case Messages.PHASE_PROFILE_RESULT:
      validateForm()

      currentProfileData = data
      processingOptions.phaseProfileForX = data.selectedX
      processingOptions.maxPhaseFromProfile = data.maxPhase

      console.time("Plotting Phase Profile")
      renderPhaseProfile(data, onPhaseProfileClick)
      console.timeEnd("Plotting Phase Profile")
      break
    case Messages.AVERAGED_PERIOD_RESULT:
      // We only request the average period for downloading
      // so all we need to do here is trigger the download
      let images = {
        psd: document.getElementById('chartPSD')
      }

      if (currentProfileData) {
        images['phase_profile'] = document.getElementById('chartProfile')
      }

      if (currentSinglePhaseData) {
        images['selected_phase'] = document.getElementById('chartSinglePhase')
      }

      downloadAnalysisArchive(
        {
          averagePeriod: data,
          psdData: currentPsdData,
          profileData: currentProfileData,
          singlePhaseData: currentSinglePhaseData,
          averagingOptions,
          parserOptions,
          processingOptions,
          canvases: images
        },
        {
          multicolumn: document.getElementById('export-multi-datasets').value,
          separator: document.getElementById('export-column-separator').value
        }
      )
    case Messages.ERROR:
      status.message = `Error: ${data.message}`
      status.type = 'error'
      progress.hide()
      validateForm()
      break
  }
}

parametersForm.addEventListener('input', validateForm)

parametersForm.addEventListener('submit', (event) => {
  event.preventDefault()
  status.message = "Processing..."
  status.type = 'info'
  runButton.disabled = true

  averagingOptions = {
    cyclePeriodSeconds: cyclePeriodInput.valueAsNumber,
    acquisitionIntervalSeconds: acquisitionIntervalInput.valueAsNumber
  }

  parserOptions = {
    xMin: Number.isNaN(xMinInput.valueAsNumber) ? -Infinity : xMinInput.valueAsNumber,
    xMax: Number.isNaN(xMaxInput.valueAsNumber) ? Infinity : xMaxInput.valueAsNumber,

    separator: sepInput.value.length > 0 ? sepInput.value : undefined,
    // Convert from the 1 based user inputs to the internal 0 based values
    xColumnIndex: Number.isNaN(xColInput.valueAsNumber) ? undefined : xColInput.valueAsNumber - 1,
    yColumnIndices: yColsInput.value.trim().length > 0 ? rangeToIntArray(yColsInput.value, -1) : undefined
  }

  processingOptions = {
    resolution: resolutionInput.valueAsNumber,
    waveType: waveTypeInput.value,
    harmonic: harmonicInput.valueAsNumber,
  }

  worker.postMessage({
      type: Messages.IMPORT_AND_RUN_PSD,
      files: [...fileInput.files],
      averagingOptions,
      parserOptions,
      processingOptions
    }
  )
})

function onPSDChartClick (x, idx) {
  status.message = "Processing..."
  status.type = 'info'
  runButton.disabled = true
  worker.postMessage({
    type: Messages.GET_PHASE_PROFILE,
    xIndex: idx,
    resolution: 1,
    waveType: processingOptions.waveType,
    harmonic: processingOptions.harmonic
  })
}

function onPhaseProfileClick (x, idx) {
  status.message = "Processing..."
  status.type = 'info'
  worker.postMessage({
    type: Messages.GET_SINGLE_PHASE,
    waveType: processingOptions.waveType,
    harmonic: processingOptions.harmonic,
    targetPhase: Math.round(x)
  })
}

downloadButton.addEventListener("click", () => {
  // We only request the average period for downloading
  // the download is triggered by the return message
  // All other data are available in this thread
  worker.postMessage({
    type: Messages.GET_AVERAGED_PERIOD
  })
})

helpButton.addEventListener('click', () => helpModal.classList.remove("hidden"))
closeHelp.addEventListener('click', () => helpModal.classList.add("hidden"))
helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) {
    helpModal.classList.add("hidden")
  }
})
