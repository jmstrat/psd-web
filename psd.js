import { SharedFileReader } from "./filereader.js"
import { WaveType } from "./wavetypes.js"
import Runner from "./wasm/module.js"

// Note that the actual calculations are done in a wasm module
// This file serves to wrap the module to facilitate memory management etc.

// SharedFileReader must have data available before calling the functions
// in this module.

// Each function can (optinally) take a runner argument generated with this
// function to allow running multiple functions without multiple copies of
// the raw data
export function allocateRunner () {
  const { averagedPeriod, timeValues } = SharedFileReader.getData()

  return new Runner()
    .allocate({
      averagedPeriod,
      timeValues
    })
}

export function runPSD (
  { resolution, waveType, harmonic },
  runner = null
) {
  if (!Object.keys(WaveType).includes(waveType)) {
    throw new Error("Unknown wave type")
  }

  const {
    metadata,
    dataType,
    x,
    spectraPerCycle,
    spectrumLength
  } = SharedFileReader.getData()

  console.time("PSD Calculation")
  const managedRunner = !runner
  if (managedRunner) {
    runner = allocateRunner()
  }

  const outputSize = Math.round(360 / resolution) * spectrumLength

  const result = runner
  .allocate({
    output: outputSize
  })
  .run((data, wasm) => {
    wasm._runPSD(
      data.averagedPeriod,
      data.timeValues,
      spectraPerCycle,
      spectrumLength,
      resolution,
      WaveType[waveType],
      harmonic,
      data.output
    )
  })
  .read('output')
  if (managedRunner) {
    runner.free()
  } else {
    runner.free('output')
  }
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

  return {
    metadata,
    dataType,
    xAxisData: new Float64Array(xBufferToTransfer),
    datasets,
    transferList
  }
}

export function getProfile ({ xIndex, resolution, waveType, harmonic }, runner=null) {
  if (!Object.keys(WaveType).includes(waveType)) {
    throw new Error("Unknown wave type")
  }

  console.time("Profile Calculation")
  const { spectraPerCycle, spectrumLength, x } = SharedFileReader.getData()
  const phaseCount = Math.floor(360.0 / resolution)

  const managedRunner = !runner
  if (managedRunner) {
    runner = allocateRunner()
  }

  const intensities = runner
  .allocate({
    output: phaseCount
  })
  .run((data, wasm) => {
    wasm._runPhaseProfile(
      data.averagedPeriod,
      data.timeValues,
      spectraPerCycle,
      spectrumLength,
      resolution,
      WaveType[waveType],
      harmonic,
      xIndex,
      data.output
    )
  })
  .read('output')
  if (managedRunner) {
    runner.free()
  } else {
    runner.free('output')
  }

  const phaseAngles = new Float64Array(phaseCount)

  for (let p = 0; p < phaseCount; p++) {
    phaseAngles[p] = p * resolution
  }

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

  return {
    intensities,
    phaseAngles,
    selectedX: x[xIndex],
    maxPhase,
    transferList
  }
}

export function getSinglePhase ({ waveType, harmonic, targetPhase }, runner=null) {
  if (!Object.keys(WaveType).includes(waveType)) {
    throw new Error("Unknown wave type")
  }

  console.time("Single Phase PSD Calculation")
  const { spectraPerCycle, spectrumLength, x, dataType } = SharedFileReader.getData()

  const managedRunner = !runner
  if (managedRunner) {
    runner = allocateRunner()
  }

  const singleSpectrum = runner
  .allocate({
    output: spectrumLength
  })
  .run((data, wasm) => {
    wasm._runPSDForSinglePhase(
      data.averagedPeriod,
      data.timeValues,
      spectraPerCycle,
      spectrumLength,
      targetPhase,
      WaveType[waveType],
      harmonic,
      data.output
    )
  })
  .read('output')
  if (managedRunner) {
    runner.free()
  } else {
    runner.free('output')
  }

  const xBufferToTransfer = x.slice().buffer
  const transferList = [xBufferToTransfer, singleSpectrum.buffer]

  console.timeEnd("Single Phase PSD Calculation")

  return({
    dataType,
    xAxisData: new Float64Array(xBufferToTransfer),
    yAxisData: singleSpectrum,
    transferList
  })
}
