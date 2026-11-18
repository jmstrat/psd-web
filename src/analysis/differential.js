import { SharedFileReader } from "@/importing/filereader.js"
import { CycleMerger } from "@/importing/cycle-merger.js"

// Note that the actual calculations are done in a wasm module
// This file serves to wrap the module to facilitate memory management etc.

// SharedFileReader must have data available before calling the functions
// in this module.

function allocRebinned (spectraPerCycle, spectrumLength, differentialResolution, runner) {
  // We could do this more efficiently, but this should work fine for most cases

  const outputSpectra = spectraPerCycle / differentialResolution

  if (!Number.isInteger(outputSpectra)) {
    throw new Error(`Invalid differentialResolution: ${spectraPerCycle} / ${differentialResolution} is non-integer`)
  }

  const merger = new CycleMerger(outputSpectra, spectrumLength, outputSpectra)
  for (let i = 0; i < spectraPerCycle; i++) {
    merger.addFrame(Math.floor(i / differentialResolution), SharedFileReader.getDataset(i))
  }

  runner.allocate({ input: merger.getAveragedPeriod() })

  return outputSpectra
}

export function runDifferential ({ referenceIndex, differentialResolution }, runner) {

  const {
    x,
    spectraPerCycle,
    spectrumLength
  } = SharedFileReader.getData()

  const outputSpectra = allocRebinned(spectraPerCycle, spectrumLength, differentialResolution, runner)

  console.time("Differential Calculation")

  const outputSize = outputSpectra * spectrumLength

  const result = runner
  .allocate({
    output: outputSize
  })
  .run((data, wasm) => {
    wasm._runDifferential(
      data.input,
      outputSpectra,
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

  for (let idx = 0; idx < outputSpectra; idx++) {
    const y = CycleMerger.extractDataset(result, spectrumLength, idx)
                         .slice()

    transferList.push(y.buffer)

    datasets.push({
      label: `${timeValues[idx * differentialResolution].toFixed(1)} s`,
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

export function getDifferentialProfile ({ xIndex, referenceIndex, differentialResolution }, runner) {
  console.time("Profile Calculation")
  const { spectraPerCycle, spectrumLength, x } = SharedFileReader.getData()

  const outputSpectra = allocRebinned(spectraPerCycle, spectrumLength, differentialResolution, runner)

  const intensities = runner
  .allocate({
    output: outputSpectra
  })
  .run((data, wasm) => {
    wasm._runDifferentialProfile(
      data.input,
      outputSpectra,
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

  const maxPhase = timeValues[maxIdx * differentialResolution]

  const transferList = [intensities.buffer]

  console.timeEnd("Profile Calculation")

  const resultTimes = []
  for (let i = 0; i < outputSpectra; i++) {
    resultTimes.push(timeValues[i * differentialResolution])
  }

  return {
    intensities,
    phaseAngles: resultTimes,
    selectedX: x[xIndex],
    maxPhase,
    transferList
  }
}

export function getDifferentialSinglePhase ({ targetPhase: targetScanTime, referenceIndex, differentialResolution }, runner) {

  console.time("Single Phase Calculation")
  const { spectraPerCycle, spectrumLength, x } = SharedFileReader.getData()

  const outputSpectra = allocRebinned(spectraPerCycle, spectrumLength, differentialResolution, runner)

  const { timeValues } = SharedFileReader.getData()

  let targetScanIndex = 0
  let minDiff = Infinity

  for (let i = 1; i < outputSpectra; i++) {
    const currentTime = timeValues[i * differentialResolution]
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
      data.input,
      outputSpectra,
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
