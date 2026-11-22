import { SharedFileReader } from "@/importing/filereader.js"
import { CycleMerger } from "@/importing/cycle-merger.js"

// Note that the actual calculations are done in a wasm module
// This file serves to wrap the module to facilitate memory management etc.

// SharedFileReader must have data available before calling the functions
// in this module.

export function runDifferential ({ referenceIndex }, runner) {

  const {
    x,
    spectraPerCycle,
    spectrumLength
  } = SharedFileReader.getData()

  console.time("Differential Calculation")

  const outputSize = spectraPerCycle * spectrumLength

  const result = runner
  .allocate({
    output: outputSize
  })
  .run((data, wasm) => {
    wasm._runDifferential(
      data.averagedPeriod,
      spectraPerCycle,
      spectrumLength,
      referenceIndex,
      data.output
    )
  })
  .read('output')

  runner.free('output')
  console.timeEnd("Differential Calculation")

  // Split the array into individual datasets and return to the main
  // thread for plotting
  console.time("Result parsing")

  const datasets = []

  // Note: We need to clone x as otherwise if we use cached data
  // it will be invalid once it has transferred
  const xBufferToTransfer = x.slice().buffer
  const transferList = [xBufferToTransfer]

  const { timeValues } = SharedFileReader.getData()

  for (let idx = 0; idx < spectraPerCycle; idx++) {
    const y = CycleMerger.extractDataset(result, spectrumLength, idx)
                         .slice()

    transferList.push(y.buffer)

    datasets.push({
      label: `${timeValues[idx].toFixed(1)} s`,
      data: y
    })
  }
  console.timeEnd("Result parsing")

  return {
    xAxisData: new Float64Array(xBufferToTransfer),
    datasets,
    transferList
  }
}

export function getDifferentialProfile ({ xIndex, referenceIndex }, runner) {
  console.time("Profile Calculation")
  const { spectraPerCycle, spectrumLength, x } = SharedFileReader.getData()

  const intensities = runner
  .allocate({
    output: spectraPerCycle
  })
  .run((data, wasm) => {
    wasm._runDifferentialProfile(
      data.averagedPeriod,
      spectraPerCycle,
      spectrumLength,
      xIndex,
      referenceIndex,
      data.output
    )
  })
  .read('output')

  runner.free('output')

  const { timeValues } = SharedFileReader.getData()

  let maxVal = -Infinity
  let maxIdx = 0

  for (let i = 0; i < intensities.length; i++) {
    const val = intensities[i]
    if (val > maxVal) {
      maxVal = val
      maxIdx = i
    }
  }

  const maxPhase = timeValues[maxIdx]

  const transferList = [intensities.buffer]

  console.timeEnd("Profile Calculation")

  const resultTimes = []
  for (let i = 0; i < spectraPerCycle; i++) {
    resultTimes.push(timeValues[i])
  }

  return {
    intensities,
    phaseAngles: resultTimes,
    selectedX: x[xIndex],
    maxPhase,
    transferList
  }
}

export function getDifferentialSinglePhase ({ targetPhase: targetScanTime, referenceIndex }, runner) {

  console.time("Single Phase Calculation")
  const { spectraPerCycle, spectrumLength, x } = SharedFileReader.getData()

  const { timeValues } = SharedFileReader.getData()

  let targetScanIndex = 0
  let minDiff = Infinity

  for (let i = 1; i < spectraPerCycle; i++) {
    const currentTime = timeValues[i]
    const currentDiff = Math.abs(currentTime - targetScanTime)

    if (currentDiff < minDiff) {
      minDiff = currentDiff
      targetScanIndex = i
    } else {
      break
    }
  }

  const singleSpectrum = runner
  .allocate({
    output: spectrumLength
  })
  .run((data, wasm) => {
    wasm._runDifferentialForSingleScan(
      data.averagedPeriod,
      spectraPerCycle,
      spectrumLength,
      targetScanIndex,
      referenceIndex,
      data.output
    )
  })
  .read('output')

  runner.free('output')

  const xBufferToTransfer = x.slice().buffer
  const transferList = [xBufferToTransfer, singleSpectrum.buffer]

  console.timeEnd("Single Phase Calculation")

  return({
    xAxisData: new Float64Array(xBufferToTransfer),
    yAxisData: singleSpectrum,
    transferList
  })
}

export function getDifferentialInPhase ({ referenceIndex, inPhaseMinIntensityThreshold }, runner) {
  console.time("In Phase Profile Calculation")

  const { spectraPerCycle, spectrumLength, x } = SharedFileReader.getData()

  runner
  .allocate({
    indicies: spectrumLength,
    intensities: spectrumLength
  })
  .run((data, wasm) => {
    wasm._runDifferentialMaxScan(
      data.averagedPeriod,
      spectraPerCycle,
      spectrumLength,
      referenceIndex,
      0,
      data.indicies,
      data.intensities
    )
  })

  const indicies = runner.read('indicies')
  const intensities = runner.read('intensities')

  runner.free('indicies')
  runner.free('intensities')

  if (Number.isFinite(inPhaseMinIntensityThreshold)) {
    for (let i = 0; i < indicies.length; i++) {
      if (intensities[i] < inPhaseMinIntensityThreshold) {
        indicies[i] = NaN
      }
    }
  }

  const { timeValues } = SharedFileReader.getData()

  const times = []

  for (const idx of indicies) {
    if (idx > 0) {
      times.push(timeValues[idx])
    } else {
      times.push(NaN)
    }
  }

  const xBufferToTransfer = x.slice().buffer
  const transferList = [xBufferToTransfer, intensities.buffer]

  console.timeEnd("In Phase Profile Calculation")

  return({
    xAxisData: new Float64Array(xBufferToTransfer),
    yAxisData: times,
    intensityData: intensities,
    transferList
  })
}
