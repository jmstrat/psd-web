import { CycleMerger } from "./cycle-merger.js"
import { ParserFactory } from "./parsers.js"
import { Accumulator } from "./util.js"
import { ExpandableBuffer } from "./util.js"

// This is the main file reading loop, it orchestrates the process and validates
// the data, but the main logic is elsewhere:
// parsers.js contains the file reading code and handles support of different file types
// cycle-merger.js handles averaging the spectra into one single period
export async function readSpectraFiles (
  files,
  cyclePeriodSeconds,
  acquisitionIntervalSeconds,
  options = {}
) {
  const { xMin = -Infinity, xMax = Infinity, progressCallback } = options

  if (!files || !files.length) {
    throw new Error("No files provided")
  }

  if (!cyclePeriodSeconds) {
    throw new Error("Invalid cyclePeriodSeconds")
  }

  if (
    typeof acquisitionIntervalSeconds !== "number" ||
    !isFinite(acquisitionIntervalSeconds) || acquisitionIntervalSeconds <= 0
  ) {
    throw new Error("Invalid acquisition interval")
  }

  if (acquisitionIntervalSeconds >= cyclePeriodSeconds) {
    throw new Error("acquisitionIntervalSeconds must be smaller than cyclePeriodSeconds")
  }

  const spectraPerCycle = Math.round(cyclePeriodSeconds / acquisitionIntervalSeconds)
  const usableLength = Math.floor(files.length / spectraPerCycle) * spectraPerCycle

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  // To avoid hammering GC all data are read into the same underlying buffers
  // As we read files sequentially this will not cause any issues and avoids
  // repeated allocations of large arrays
  const sharedXBuffer = new ExpandableBuffer(Float64Array, 6000)
  const sharedYBuffer = new ExpandableBuffer(Float64Array, 6000)
  const metadataAccumulator = new Accumulator()

  let merger = null
  let xAxis = null
  let xSignature = null
  let spectrumLength = null
  let dataType = null
  let t0 = null

  for (let i = 0; i < usableLength; i++) {
    const file = files[i]
    const parser = ParserFactory.getParserForFile(file.name)

    // Read the data
    const { metadata, x, y } = await parser.parseStream(file.stream(), {
      xBuffer: sharedXBuffer,
      yBuffer: sharedYBuffer,
      immutable: false,
      xMin,
      xMax
    })

    // Store any metadata found in the file whilst reading it
    metadataAccumulator.merge(metadata)

    // This is used to validate that the x axis is the same for every file
    const sig = makeSignature(x)

    if (!xSignature) {
      // First file, extract constants and prepare for averaging
      xSignature = sig
      spectrumLength = y.length
      xAxis = x.slice(0, spectrumLength)
      dataType = parser.dataType
      t0 = i * acquisitionIntervalSeconds

      merger = new CycleMerger(spectraPerCycle, spectrumLength, cyclePeriodSeconds)
    } else {
      // Subsequent files we just validate that the axes match
      if (!compareSignature(xSignature, sig)) {
        throw new Error(`X-axis mismatch: ${file.name}`)
      }
      if (y.length !== spectrumLength) {
        throw new Error(`Length mismatch: ${file.name}`)
      }
    }

    // Relative to first frame
    const relT = i * acquisitionIntervalSeconds - t0
    // Store the data
    merger.addFrame(relT, y)

    if (progressCallback) {
      progressCallback({
        current: i + 1,
        total: files.length
      })
    }
  }

  const discarded = files.length - usableLength
  if (discarded > 0) {
    console.warn(`${discarded} spectra discarded (incomplete final cycle)`)
  }

  if (!merger) {
    return null
  }

  const averagedPeriod = merger.getAveragedPeriod()

  // Generate the timeValues for the averaged period
  const timeValues = new Float64Array(spectraPerCycle)
  for (let k = 0; k < spectraPerCycle; k++) {
    timeValues[k] = k * acquisitionIntervalSeconds
  }

  return {
    metadata: metadataAccumulator.getResults(),
    dataType,
    x: xAxis,
    timeValues,
    averagedPeriod,
    spectraPerCycle,
    spectrumLength
  }
}

function makeSignature(x) {
  return {
    length: x.length,
    first: x[0],
    step: x.length > 1 ? x[1] - x[0] : 0,
    last: x[x.length - 1]
  }
}

function compareSignature(a, b) {
  const EPSILON = 1e-9
  return (
    a.length === b.length &&
    Math.abs(a.first - b.first) < EPSILON &&
    Math.abs(a.step - b.step) < EPSILON &&
    Math.abs(a.last - b.last) < EPSILON
  )
}
