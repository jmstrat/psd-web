import { Messages } from "./messages.js"
import {
  destroyPSD, renderPSD,
  destroyPhaseProfile, renderPhaseProfile,
  destroySinglePhase, renderSinglePhase
} from "./charts/index.js"
import { downloadAnalysisArchive } from "./download.js"

// All calculations and file parsing are done in the worker thread
// The main thread just handles the UI (and plotting)
const worker = new Worker("worker.js", { type: "module" })

const status = document.getElementById("status")
const progressBar = document.getElementById('progressBar')
const progressText = document.getElementById('progressText')
const downloadButton = document.getElementById('downloadButton')
const runButton = document.getElementById("runButton")
const fileInput = document.getElementById("fileUpload")
const chooseButton = document.getElementById("chooseFile")
const metadataContainer = document.getElementById("metadataContainer")

const parametersForm = document.getElementById("parameters")
const cyclePeriodInput = document.getElementById("cyclePeriod")
const acquisitionIntervalInput = document.getElementById("acquisitionInterval")
const waveTypeInput = document.getElementById("waveType")
const harmonicInput = document.getElementById("harmonic")
const resolutionInput = document.getElementById("resolution")
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
    progressText.textContent = ""
    progressBar.style.display = "none"
    return
  }

  runButton.disabled = false
  status.textContent = "Ready"
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

  Object.entries(metadata).forEach(([key, value]) => {
    const row = document.createElement("div")
    row.className = "meta-row"

    const label = document.createElement("span")
    label.className = "meta-label"
    label.textContent = key.replace(/([A-Z])/g, ' $1').trim()

    row.appendChild(label)

    if (Array.isArray(value)) {
      const badgeWrapper = document.createElement("div")
      badgeWrapper.className = "meta-badges"

      value.forEach(item => {
        const badge = document.createElement("span")
        badge.className = "meta-badge"
        badge.textContent = item
        badgeWrapper.appendChild(badge)
      })
      row.appendChild(badgeWrapper)
    } else {
      const valueSpan = document.createElement("span")
      valueSpan.className = "meta-value"
      valueSpan.textContent = value
      row.appendChild(valueSpan)
    }

    metadataContainer.appendChild(row)
  })
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
      progressBar.style.display = "block"

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
        progressBar.style.display = "none"
        progressText.textContent = ""
        downloadButton.disabled = false
      }
      break
    case Messages.RESULT:
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
      currentParameters.selectedX = data.selectedX

      console.time("Plotting Phase Profile")
      renderPhaseProfile(data, onPhaseProfileClick)
      console.timeEnd("Plotting Phase Profile")
      break
    case Messages.ERROR:
      status.textContent = `Error: ${data.message}`
      progressBar.style.display = "none"
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
    xMax: Number.isNaN(xMaxInput.valueAsNumber) ? Infinity : xMaxInput.valueAsNumber
  }

  worker.postMessage({
      type: Messages.PROCESS,
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
    targetPhase: x
  })
}

downloadButton.addEventListener("click", () => {
  downloadAnalysisArchive({
    psdData: currentPsdData,
    profileData: currentProfileData,
    singlePhaseData: currentSinglePhaseData,
    parameters: currentParameters
  })
})
