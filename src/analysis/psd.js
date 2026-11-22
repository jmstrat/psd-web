import { SharedFileReader } from "@/importing/filereader.js"
import { CycleMerger } from "@/importing/cycle-merger.js"
import { WaveType } from "./wavetypes.js"

// Note that the actual calculations are done in a wasm module
// This file serves to wrap the module to facilitate memory management etc.

// SharedFileReader must have data available before calling the functions
// in this module.

export function runPSD (
  { resolution, waveType, harmonic },
  runner
) {
  if (!Object.keys(WaveType).includes(waveType)) {
    throw new Error("Unknown wave type")
  }

  const {
    x,
    spectraPerCycle,
    spectrumLength
  } = SharedFileReader.getData()

  console.time("PSD Calculation")

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

  runner.free('output')
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
    const phaseYData = CycleMerger.extractDataset(result, spectrumLength, phaseIndex).slice()

    transferList.push(phaseYData.buffer)

    datasets.push({
      label: `${phaseAngle.toFixed(1)}°`,
      data: phaseYData
    })
  }
  console.timeEnd("Result parsing")

  return {
    xAxisData: new Float64Array(xBufferToTransfer),
    datasets,
    transferList
  }
}

export function getProfile ({ xIndex, resolution, waveType, harmonic }, runner) {
  if (!Object.keys(WaveType).includes(waveType)) {
    throw new Error("Unknown wave type")
  }

  console.time("Profile Calculation")
  const { spectraPerCycle, spectrumLength, x } = SharedFileReader.getData()
  const phaseCount = Math.floor(360.0 / resolution)

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

  runner.free('output')

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

export function getSinglePhase ({ waveType, harmonic, targetPhase }, runner) {
  if (!Object.keys(WaveType).includes(waveType)) {
    throw new Error("Unknown wave type")
  }

  console.time("Single Phase PSD Calculation")
  const { spectraPerCycle, spectrumLength, x } = SharedFileReader.getData()

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

  runner.free('output')

  const xBufferToTransfer = x.slice().buffer
  const transferList = [xBufferToTransfer, singleSpectrum.buffer]

  console.timeEnd("Single Phase PSD Calculation")

  return({
    xAxisData: new Float64Array(xBufferToTransfer),
    yAxisData: singleSpectrum,
    transferList
  })
}

export function getAllInPhase ({ waveType, harmonic, resolution, inPhaseMinIntensityThreshold }, runner) {
if (!Object.keys(WaveType).includes(waveType)) {
    throw new Error("Unknown wave type")
  }

  console.time("In Phase Profile Calculation")
  const { spectraPerCycle, spectrumLength, x } = SharedFileReader.getData()

  runner
  .allocate({
    angles: spectrumLength,
    intensities: spectrumLength
  })
  .run((data, wasm) => {
    wasm._runPSDMaxPhase(
      data.averagedPeriod,
      data.timeValues,
      spectraPerCycle,
      spectrumLength,
      resolution,
      WaveType[waveType],
      harmonic,
      data.angles,
      data.intensities
    )
  })

  const angles = runner.read('angles')
  const intensities = runner.read('intensities')

  runner.free('angles')
  runner.free('intensities')

  if (Number.isFinite(inPhaseMinIntensityThreshold)) {
    for (let i = 0; i < angles.length; i++) {
      if (intensities[i] < inPhaseMinIntensityThreshold) {
        angles[i] = NaN
      }
    }
  }

  const xBufferToTransfer = x.slice().buffer
  const transferList = [xBufferToTransfer, angles.buffer, intensities.buffer]

  console.timeEnd("In Phase Profile Calculation")

  return({
    xAxisData: new Float64Array(xBufferToTransfer),
    yAxisData: angles,
    intensityData: intensities,
    transferList
  })
}
