import { readSpectraFiles } from "./filereader.js"
import { Messages } from "./messages.js"
import { WaveType } from "./wavetypes.js"
import ModuleFactory from "./wasm-dist/psd.js"

// TODO: This file is messy and should be refactored

const Module = await ModuleFactory()

if (Module.onRuntimeInitialized) {
  await new Promise((resolve) => {
    Module.onRuntimeInitialized = () => resolve()
  })
}

postMessage({ type: Messages.READY })

let cachedSpectrumData = null
let cachedConfigSignature = ""

// Determines whether the cached data is still valid
function shouldReload (files, config) {
  if (!files || !files.length) {
    cachedConfigSignature = ""
    return true
  }

  const filesPart = files.map(f => `${f.name}_${f.size}_${f.lastModified}`).join("|")
  const configPart = `${config.cyclePeriodSeconds}_${config.acquisitionIntervalSeconds}_${config.xMin}_${config.xMax}`
  const currentSignature = `${filesPart}||${configPart}`

  if (currentSignature === cachedConfigSignature) {
    return false
  }

  cachedConfigSignature = currentSignature
  return true
}

async function runPSD ({
  files,
  cyclePeriodSeconds,
  acquisitionIntervalSeconds,
  resolution,
  waveType,
  harmonic,
  xMin,
  xMax
}) {
  if (!Object.keys(WaveType).includes(waveType)) {
    throw new Error("Unknown wave type")
  }

  let spectrumData
  const filesChanged = shouldReload(files, { cyclePeriodSeconds, acquisitionIntervalSeconds, xMin, xMax })
  if (cachedSpectrumData && !filesChanged) {
    console.log("Using cached data")
    spectrumData = cachedSpectrumData
  } else {
    console.time("Read Data")
    spectrumData = await readSpectraFiles(
      files,
      cyclePeriodSeconds,
      acquisitionIntervalSeconds,
      {
        xMin,
        xMax,
        progressCallback: (p) => postMessage({
          type: Messages.PROGRESS,
          stage: "read",
          ...p
        })
      }
    )
    console.timeEnd("Read Data")
    cachedSpectrumData = spectrumData
  }

  const {
    metadata,
    dataType,
    x,
    timeValues,
    averagedPeriod,
    spectraPerCycle,
    spectrumLength
  } = spectrumData

  postMessage({
    type: Messages.PROGRESS,
    stage: "calculate"
  })

  console.time("PSD Calculation")
  const averagedPeriodPtr = Module._malloc(averagedPeriod.byteLength)
  const averagedView = new Float64Array(
    Module.HEAPF64.buffer,
    averagedPeriodPtr,
    averagedPeriod.length
  )

  averagedView.set(averagedPeriod)

  const timePtr = Module._malloc(timeValues.byteLength)

  const timeView = new Float64Array(
    Module.HEAPF64.buffer,
    timePtr,
    timeValues.length
  )

  timeView.set(timeValues)

  const outputSize = Module._getPSDOutputSize(spectrumLength, resolution)
  const outputPtr = Module._malloc(outputSize * Float64Array.BYTES_PER_ELEMENT)

  Module._runPSD(
    averagedPeriodPtr,
    timePtr,
    spectraPerCycle,
    spectrumLength,
    resolution,
    WaveType[waveType],
    harmonic,
    outputPtr
  )

  const result = new Float64Array(
    Module.HEAPF64.buffer,
    outputPtr,
    outputSize
  ).slice()

  Module._free(averagedPeriodPtr)
  Module._free(timePtr)
  Module._free(outputPtr)
  console.timeEnd("PSD Calculation")

  // Split the array into individual datasets and return to the main
  // thread for plotting
  console.time("Result parsing")
  const phaseCount = result.length / spectrumLength
  const datasets = []

  // Note: We need to clone x as otherwise if we use cached data
  // it will be invalid once it has transferred
  const xBufferToTransfer = x.slice().buffer
  const transferList = [xBufferToTransfer]

  for (let phaseIndex = 0; phaseIndex < phaseCount; phaseIndex++) {
    const phaseAngle = phaseIndex * resolution
    const offset = phaseIndex * spectrumLength

    const phaseYData = new Float64Array(
      result.buffer,
      result.byteOffset + (offset * Float64Array.BYTES_PER_ELEMENT),
      spectrumLength
    ).slice()

    transferList.push(phaseYData.buffer)

    datasets.push({
      label: `${phaseAngle.toFixed(1)}°`,
      data: phaseYData
    })
  }
  console.timeEnd("Result parsing")

  postMessage({
    type: Messages.PROGRESS,
    stage: "finished"
  })

  postMessage({
    type: Messages.RESULT,
    metadata,
    dataType,
    xAxisData: new Float64Array(xBufferToTransfer),
    datasets
  }, transferList)
}

function getProfile ({ xIndex, resolution, waveType, harmonic }) {
  if (!cachedSpectrumData) {
    throw new Error("No cached spectrum data available. Run analysis first.")
  }

  if (!Object.keys(WaveType).includes(waveType)) {
    throw new Error("Unknown wave type")
  }

  postMessage({
    type: Messages.PROGRESS,
    stage: "calculate"
  })

  console.time("Profile Calculation")
  const { averagedPeriod, timeValues, spectraPerCycle, spectrumLength, x, dataType } = cachedSpectrumData

  const phaseCount = Math.floor(360.0 / resolution)

  const averagedPeriodPtr = Module._malloc(averagedPeriod.byteLength)
  const averagedView = new Float64Array(Module.HEAPF64.buffer, averagedPeriodPtr, averagedPeriod.length)
  averagedView.set(averagedPeriod)

  const timePtr = Module._malloc(timeValues.byteLength)
  const timeView = new Float64Array(Module.HEAPF64.buffer, timePtr, timeValues.length)
  timeView.set(timeValues)

  const outputSizeBytes = phaseCount * Float64Array.BYTES_PER_ELEMENT
  const outputPtr = Module._malloc(outputSizeBytes)

  Module._runPhaseProfile(
    averagedPeriodPtr,
    timePtr,
    spectraPerCycle,
    spectrumLength,
    resolution,
    WaveType[waveType],
    harmonic,
    xIndex,
    outputPtr
  )

  const intensities = new Float64Array(phaseCount)
  const phaseAngles = new Float64Array(phaseCount)

  intensities.set(new Float64Array(Module.HEAPF64.buffer, outputPtr, phaseCount))

  for (let p = 0; p < phaseCount; p++) {
    phaseAngles[p] = p * resolution
  }

  Module._free(averagedPeriodPtr)
  Module._free(timePtr)
  Module._free(outputPtr)

  let maxVal = -Infinity
  let maxIdx = 0

  for (let i = 0; i < intensities.length; i++) {
    const val = intensities[i]
    if (val > maxVal) {
      maxVal = val
      maxIdx = i
    }
  }

  const maxPhase = phaseAngles[maxIdx]

  const transferList = [intensities.buffer, phaseAngles.buffer]

  console.timeEnd("Profile Calculation")

  postMessage({
    type: Messages.PHASE_PROFILE_RESULT,
    intensities,
    phaseAngles,
    selectedX: x[xIndex]
  }, transferList)

  console.time("Single Phase PSD Calculation")

  const singleOutputPtr = Module._malloc(
    spectrumLength * Float64Array.BYTES_PER_ELEMENT
  )

  Module._runPSDForSinglePhase(
    averagedPeriodPtr,
    timePtr,
    spectraPerCycle,
    spectrumLength,
    maxPhase,
    WaveType[waveType],
    harmonic,
    singleOutputPtr
  )

  const singleSpectrum = new Float64Array(
    Module.HEAPF64.buffer,
    singleOutputPtr,
    spectrumLength
  ).slice()

  Module._free(singleOutputPtr)

  const xBufferToTransfer = x.slice().buffer
  const transferList2 = [xBufferToTransfer, singleSpectrum.buffer]

  console.timeEnd("Single Phase PSD Calculation")

  postMessage({
    type: Messages.PROGRESS,
    stage: "finished"
  })

  postMessage({
    type: Messages.SINGLE_PHASE_RESULT,
    targetPhase: maxPhase,
    dataType,
    xAxisData: new Float64Array(xBufferToTransfer),
    yAxisData: singleSpectrum,
  }, transferList2)
}

onmessage = async ({ data }) => {
  switch (data.type) {
    case Messages.PROCESS: {
      try {
        await runPSD(data)
      } catch (err) {
        console.error(err)
        postMessage({
          type: Messages.ERROR,
          message: err?.message ?? err
        })
      }
      break
    }
    case Messages.GET_PHASE_PROFILE: {
      try {
        getProfile(data)
      } catch (err) {
        console.error(err)
        postMessage({
          type: Messages.ERROR,
          message: err?.message ?? err
        })
      }
      break
    }
  }
}
