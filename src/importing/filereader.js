import { CycleMerger } from "./cycle-merger.js"
import { ParserFactory } from "./parsers/"
import { Accumulator, BufferPool } from "./util.js"

// This is the main file reading loop, it orchestrates the process and validates
// the data, but the main logic is elsewhere:
// parsers.js contains the file reading code and handles support of different file types
// cycle-merger.js handles averaging the spectra into one single period
async function readSpectraFiles (
  files,
  averagingOptions = {},
  parserOptions = {},
  progressCallback = null
) {

  const {
    cyclePeriodSeconds,
    acquisitionIntervalSeconds
  } = averagingOptions

  if (!files || !files.length) {
    throw new Error("No files provided")
  }

  if (
    typeof cyclePeriodSeconds !== "number" ||
    !isFinite(cyclePeriodSeconds) || cyclePeriodSeconds <= 0
  ) {
    throw new Error("Invalid cycle period")
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

  // To avoid hammering GC all data are read into the same underlying buffers
  // As we read files sequentially this will not cause any issues and avoids
  // repeated allocations of large arrays
  const pool = new BufferPool(6000)
  const metadataAccumulator = new Accumulator()

  parserOptions = {
    ...parserOptions,
    bufferPool: pool,
    immutable: false
  }

  const spectraPerCycle = Math.round(cyclePeriodSeconds / acquisitionIntervalSeconds)

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  // Inspect the first file to find the number of y columns returned per file
  // Note that we assume all files have the same column spec
  const preFlightParser = ParserFactory.getParserForFile(files[0].name, parserOptions)
  const columnsPerFile = await preFlightParser.getDatasetCount(files[0])
  preFlightParser.releaseBuffers()

  const totalSpectra = files.length * columnsPerFile
  const usableSpectraLength = Math.floor(totalSpectra / spectraPerCycle) * spectraPerCycle
  const usableFileLength = Math.ceil(usableSpectraLength / columnsPerFile)

  let merger = null
  let xAxis = null
  let xSignature = null
  let spectrumLength = null
  let dataType = null
  let t0 = null
  let frames = 0

  // TODO we should allow the actual time to be parsed from the file

  for (let i = 0; i < usableFileLength; i++) {
    const file = files[i]
    const parser = ParserFactory.getParserForFile(file.name, parserOptions)

    // Read the data
    const { metadata, x, y: yArray } = await parser.parse(file)

    if (yArray.length !== columnsPerFile) {
      throw new Error(`Y column mismatch: ${file.name}. All files must provide the same number of datasets.`)
    }

    // Store any metadata found in the file whilst reading it
    metadataAccumulator.merge(metadata)

    // This is used to validate that the x axis is the same for every file
    const sig = makeSignature(x)

    let reachedLimit = false
    for (const y of yArray) {
      // If we are past the final complete cycle then we ignore any additional data
      if (frames >= usableSpectraLength) {
        reachedLimit = true
        break
      }

      if (!xSignature) {
        // First file, extract constants and prepare for averaging
        xSignature = sig
        spectrumLength = y.length
        xAxis = x.slice(0, spectrumLength)
        dataType = parser.dataType
        t0 = frames * acquisitionIntervalSeconds

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
      const relT = frames++ * acquisitionIntervalSeconds - t0
      // Store the data
      merger.addFrame(relT, y)
    }

    // Release shared buffers (so they can be reused for the next file)
    parser.releaseBuffers()

    if (progressCallback) {
      progressCallback({
        current: i + 1,
        total: files.length
      })
    }

    if (reachedLimit) {
      break
    }
  }

  const discarded = totalSpectra - usableSpectraLength
  if (discarded > 0) {
    console.warn(`${discarded} spectra discarded (incomplete final cycle)`)
  }

  if (!merger) {
    throw new Error('No complete cycles were found to import')
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

function makeSignature (x) {
  return {
    length: x.length,
    first: x[0],
    step: x.length > 1 ? x[1] - x[0] : 0,
    last: x[x.length - 1]
  }
}

function compareSignature (a, b) {
  const EPSILON = 1e-9
  return (
    a.length === b.length &&
    Math.abs(a.first - b.first) < EPSILON &&
    Math.abs(a.step - b.step) < EPSILON &&
    Math.abs(a.last - b.last) < EPSILON
  )
}

// Simple cache helper to avoid re-reading files
class CachedFileReader {
  cachedData = null
  cachedSignature = ""

  #getSignature (files, averagingOptions, parserOptions) {
    if (!files || !files.length) {
      return ""
    }

    const filesPart = files.map(f => `${f.name}_${f.size}_${f.lastModified}`).join("|")
    const configPart = `${JSON.stringify(averagingOptions)}||${JSON.stringify(parserOptions)}`
    return `${filesPart}||${configPart}`
  }

  async loadData (files, averagingOptions, parserOptions, progressCallback) {
    const newSignature = this.#getSignature(files, averagingOptions, parserOptions)
    if (this.cachedSignature === newSignature) {
      console.log("Using cached data")
      return this.cachedData
    }
    console.time("Read Data")
    const data = await readSpectraFiles(files, averagingOptions, parserOptions, progressCallback)
    console.timeEnd("Read Data")
    this.cachedData = data
    this.cachedSignature = newSignature
    return data
  }

  getData () {
    if (!this.cachedData) {
      throw new Error("No spectrum data available. Load data before running analysis.")
    }
    return this.cachedData
  }

  get xAxis () {
    return this.getData().x
  }

  get timeAxis () {
    return this.getData().timeValues
  }

  get datasetCount () {
    return this.getData().spectraPerCycle
  }

  get dataType () {
    return this.getData().dataType
  }

  getDataset (index) {
    const { averagedPeriod, spectrumLength } = this.getData()
    return CycleMerger.extractDataset(averagedPeriod, spectrumLength, index)
  }
}

export const SharedFileReader = new CachedFileReader()
