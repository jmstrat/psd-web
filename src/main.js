import './styles.css'
import { Messages } from "./messages.js"
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

const status = document.getElementById("status")
const progressContainer = document.getElementById('progressContainer')
const progressBar = document.getElementById('progressBar')
const progressText = document.getElementById('progressText')

const downloadButton = document.getElementById('downloadButton')
const runButton = document.getElementById("runButton")
const fileInput = document.getElementById("fileUpload")
const fileStatus = document.getElementById("uploadStatus")
const chooseButton = document.getElementById("chooseFile")
const metadataContainer = document.getElementById("metadataContainer")

const helpButton = document.getElementById("helpButton")
const closeHelp = document.getElementById("closeHelp")
const helpModal = document.getElementById("helpModal")

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
let currentParameters = {}

let isWorkerReady = false

function updateReadyState () {
  const hasFiles = fileInput.files && fileInput.files.length > 0

  if (!isWorkerReady) {
    runButton.disabled = true
    status.textContent = "Loading..."
    return
  }

  if (!hasFiles) {
    runButton.disabled = true
    status.textContent = "Please select files to begin"
    fileStatus.textContent = "No files selected"

    progressText.textContent = ""
    progressContainer.classList.add("opacity-0")
    progressContainer.classList.remove("opacity-100")
    return
  }

  runButton.disabled = false
  status.textContent = "Ready"
  fileStatus.textContent = `${fileInput.files.length} files ready to process`
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
  updateReadyState()
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
      progressContainer.classList.remove("opacity-0")
      progressContainer.classList.add("opacity-100")

      if (data.stage === 'read') {
        status.textContent = "Reading files..."
        progressBar.max = data.total || 100
        progressBar.value = data.current || 0
        progressText.textContent = `Reading ${data.current} of ${data.total}`
      } else if (data.stage === 'calculate') {
        status.textContent = "Processing..."
        progressBar.removeAttribute('value')
      } else if (data.stage === 'finished') {
        status.textContent = "Finished"
        progressContainer.classList.add("opacity-0")
        progressContainer.classList.remove("opacity-100")
        progressText.textContent = ""
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
      currentParameters.selectedPhase = data.targetPhase

      console.time("Plotting Single Phase")
      renderSinglePhase(data)
      console.timeEnd("Plotting Single Phase")
      break
    case Messages.PHASE_PROFILE_RESULT:
      validateForm()

      currentProfileData = data
      currentParameters.phaseProfileForX = data.selectedX
      currentParameters.maxPhaseFromProfile = data.maxPhase

      console.time("Plotting Phase Profile")
      renderPhaseProfile(data, onPhaseProfileClick)
      console.timeEnd("Plotting Phase Profile")
      break
    case Messages.AVERAGED_PERIOD_RESULT:
      // We only request the average period for downloading
      // so all we need to do here is trigger the download
      downloadAnalysisArchive({
        averagePeriod: data,
        psdData: currentPsdData,
        profileData: currentProfileData,
        singlePhaseData: currentSinglePhaseData,
        parameters: currentParameters
      })
    case Messages.ERROR:
      status.textContent = `Error: ${data.message}`
      progressContainer.classList.add("opacity-0")
      progressContainer.classList.remove("opacity-100")
      progressText.textContent = ""
      validateForm()
      break
  }
}

parametersForm.addEventListener('input', validateForm)

parametersForm.addEventListener('submit', (event) => {
  event.preventDefault()
  status.textContent = "Processing..."
  runButton.disabled = true

  currentParameters = {
    cyclePeriodSeconds: cyclePeriodInput.valueAsNumber,
    acquisitionIntervalSeconds: acquisitionIntervalInput.valueAsNumber,
    resolution: resolutionInput.valueAsNumber,
    waveType: waveTypeInput.value,
    harmonic: harmonicInput.valueAsNumber,
    xMin: Number.isNaN(xMinInput.valueAsNumber) ? -Infinity : xMinInput.valueAsNumber,
    xMax: Number.isNaN(xMaxInput.valueAsNumber) ? Infinity : xMaxInput.valueAsNumber
  }

  worker.postMessage({
      type: Messages.IMPORT_AND_RUN_PSD,
      files: [...fileInput.files],
      ...currentParameters
    }
  )
})

function onPSDChartClick (x, idx) {
  status.textContent = "Processing..."
  runButton.disabled = true
  worker.postMessage({
    type: Messages.GET_PHASE_PROFILE,
    xIndex: idx,
    resolution: 1,
    waveType: currentParameters.waveType,
    harmonic: currentParameters.harmonic
  })
}

function onPhaseProfileClick (x, idx) {
  status.textContent = "Processing..."
  runButton.disabled = true
  worker.postMessage({
    type: Messages.GET_SINGLE_PHASE,
    waveType: currentParameters.waveType,
    harmonic: currentParameters.harmonic,
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
