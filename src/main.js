import './styles.css'
import { Messages, ProgressStage } from "./messages.js"
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

const downloadButton = document.getElementById('downloadButton')
const runButton = document.getElementById("runButton")
const helpButton = document.getElementById("helpButton")
const closeHelp = document.getElementById("closeHelp")
const helpModal = document.getElementById("helpModal")

const fileInput = document.getElementById("fileUpload")
const fileStatus = document.getElementById("uploadStatus")
const chooseButton = document.getElementById("chooseFile")

const metadataContainer = document.getElementById("metadataContainer")

const parametersForm = document.getElementById("parameters")
const cyclePeriodInput = document.getElementById("cyclePeriod")
const acquisitionIntervalInput = document.getElementById("acquisitionInterval")
const waveTypeInput = document.getElementById("waveType")
const harmonicInput = document.getElementById("harmonic")
const resolutionInput = document.getElementById("resolution")
const xMinInput = document.getElementById("xMin")
const xMaxInput = document.getElementById("xMax")

let currentPsdData = null
let currentProfileData = null
let currentSinglePhaseData = null

let averagingOptions = {}
let parserOptions = {}
let processingOptions = {}

let isWorkerReady = false

class StatusMessage {
  #element
  #span
  #type
  #typeStyles = {
    info: { bg: 'bg-blue-100', text: 'text-blue-700' },
    success: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    error: { bg: 'bg-rose-100', text: 'text-rose-700' }
  }

  constructor (element) {
    this.#element = element
    this.#span = element.querySelector('#status') || element.querySelector('span')
    this.message = "Loading..."
    this.type = 'info'
  }

  set message (text) {
    if (this.#span) {
      this.#span.textContent = text
    }
  }

  get type () {
    return this.#type
  }

  set type (type) {
    this.#type = type
    const config = this.#typeStyles[type] || this.#typeStyles.info

    Object.values(this.#typeStyles).forEach(style => {
      this.#element.classList.remove(style.bg, style.text)
    })

    this.#element.classList.add(config.bg, config.text)
  }
}

class ProgressBar {
  #container
  #bar
  #message

  constructor (containerElement) {
    this.#container = containerElement
    this.#bar = containerElement.querySelector('#progressBar')
    this.#message = containerElement.querySelector('#progressText')

    this.message = "Processing..."
    this.progress = null
  }

  show () {
    this.#container.classList.remove('opacity-0')
    this.#container.classList.add('opacity-100')
  }

  hide () {
    this.#container.classList.remove('opacity-100')
    this.#container.classList.add('opacity-0')
    this.progress = 0
  }

  set message (text) {
    if (this.#message) {
      this.#message.textContent = text
    }
  }

  set progress (value) {
    if (value === null || value === undefined) {
      this.#bar.removeAttribute('value')
    } else {
      this.#bar.value = value
    }
  }

  set min (value) {
    this.#bar.min = value
  }

  set max (value) {
    this.#bar.max = value
  }
}

const status = new StatusMessage(document.getElementById("statusBadge"))
const progress = new ProgressBar(document.getElementById('progressContainer'))

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

    fileStatus.textContent = "No files selected"

    progress.hide()
    return
  }

  fileStatus.textContent = `${fileInput.files.length} files ready to process`

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

  if (status.type !== 'error') {
    updateReadyState()
  }
}

function renderMetadata (metadata) {
  metadataContainer.innerHTML = ""

  for (const [key, value] of Object.entries(metadata)) {
    const row = document.createElement("div")
    row.className = "flex flex-col gap-1 border-b border-dashed border-slate-200 pb-3 last:border-0 last:pb-0"

    const label = document.createElement("span")
    label.className = "font-semibold text-slate-700"
    const humanKey = key.replace(/([A-Z])/g, ' $1').trim()
    label.textContent = humanKey.charAt(0).toUpperCase() + humanKey.slice(1)

    row.appendChild(label)

    if (Array.isArray(value)) {
      const badgeWrapper = document.createElement("div")
      badgeWrapper.className = "flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto mt-0.5 scrollbar-simple"

      for (const item of value) {
        const badge = document.createElement("span")
        badge.className = "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600"
        badge.textContent = item
        badgeWrapper.appendChild(badge)
      }
      row.appendChild(badgeWrapper)
    } else {
      const valueSpan = document.createElement("span")
      valueSpan.className = "text-slate-500 break-all"
      valueSpan.textContent = value
      row.appendChild(valueSpan)
    }

    metadataContainer.appendChild(row)
  }
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
      renderMetadata(data.metadata)

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
    xMax: Number.isNaN(xMaxInput.valueAsNumber) ? Infinity : xMaxInput.valueAsNumber
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
