import { ExpandableBuffer, BufferPool } from "./util.js"

// We use a class based system to parse data files so that it is easy to extend support
// to additional file types. All parsers must extend from BaseParser. They should at
// minimum implement parse(). dataType should be set if known, and is used to set the
// axis titles for the main plots.
class BaseParser {
  static status = {
    no_data: 0,
    valid_data: 1,
    finished: 2
  }

  dataType = {
    id: "unknown",
    xlab: "x / unknown",
    ylab: "intensity / unknown"
  }

  constructor (options = {}) {
    this.metadata = {}
    this.activeXBuffer = null
    this.activeYBuffers = null
    this.activePool = null

    this.options = this.validateOptions(options)
  }

  releaseBuffers () {
    if (!this.activePool) {
      return
    }
    if (this.activeXBuffer) {
      this.activePool.returnBuffers([this.activeXBuffer])
      this.activeXBuffer = null
    }
    if (this.activeYBuffers) {
      this.activePool.returnBuffers(this.activeYBuffers)
      this.activeYBuffers = null
    }
    this.activePool = null
  }

  validateOptions (options = {}) {
    const opts = {
      bufferPool: options.bufferPool || new BufferPool(),
      mismatchedColumnStrategy: options.mismatchedColumnStrategy || "throw",
      immutable: !!options.immutable,
      maxRows: options.maxRows !== undefined ? options.maxRows : Infinity
    }

    if (!(opts.bufferPool instanceof BufferPool)) {
      throw new TypeError("bufferPool must be an instance of BufferPool")
    }

    const allowedStrategies = ["throw", "pad-0"]
    if (!allowedStrategies.includes(opts.mismatchedColumnStrategy)) {
      throw new TypeError('mismatchedColumnStrategy must be either "throw" or "pad-0"')
    }

    if (opts.maxRows !== Infinity) {
      if (!Number.isInteger(opts.maxRows) || opts.maxRows <= 0) {
        throw new TypeError("maxRows must be a positive integer or Infinity")
      }
    }

    return opts
  }

  async parse (file) {
    throw new Error("parse() must be implemented by subclass")
  }

  async getDatasetCount (file) {
    throw new Error("getDatasetCount() must be implemented by subclass")
  }
}

// TextParser reads a plain text file line by line
// subclasses MUST implement parseLine to actually import data
// subclasses may optionally implement parseHeaderLine to skip or read
// metadata from headers
// If a subclass takes options, then validateOptions should also be implemented
class TextParser extends BaseParser {
  constructor (options = {}) {
    super(options)
    this.isHeaderSection = true
    this.expectedYCount = -1
  }

  async parse (file) {
    const fileStream = file.stream()
    const reader = fileStream.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""

    const pool = this.options.bufferPool
    this.activePool = pool
    this.activeXBuffer = pool.requestBuffer()
    this.activeYBuffers = [pool.requestBuffer()]

    this.expectedYCount = -1
    this.isHeaderSection = true

    // outResult container avoids repeated allocations
    const outResult = {
      x: 0,
      yValues: new ExpandableBuffer(Float64Array, 16),
      parsedCount: 0
    }

    let shouldBreak = false
    let validRowsParsed = 0

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (value) {
          buffer += value
        }

        let i = 0
        let len = buffer.length
        let lineStart = 0

        while (i < len) {
          const char = buffer[i]

          if (char === '\n' || char === '\r') {
            const line = buffer.substring(lineStart, i)

            if (line.length > 0) {
              const status = this.#processLine(line, this.activeXBuffer, this.activeYBuffers, outResult, pool)

              if (status === BaseParser.status.valid_data) {
                validRowsParsed++
                if (validRowsParsed >= this.options.maxRows) {
                  shouldBreak = true
                  break
                }
              }

              if (status === BaseParser.status.finished) {
                shouldBreak = true
                break
              }
            }

            if (char === '\r' && i + 1 < len && buffer[i + 1] === '\n') {
              i++
            }
            lineStart = i + 1
          }
          i++
        }

        if (shouldBreak) {
          await reader.cancel("All required data was read")
          break
        }

        buffer = buffer.substring(lineStart)

        if (done) {
          if (buffer.length > 0) {
            this.#processLine(buffer, this.activeXBuffer, this.activeYBuffers, outResult, pool)
          }
          break
        }
      }
    } finally {
      reader.releaseLock()
    }

    const immutable = this.options.immutable
    const yOutputs = new Array(this.activeYBuffers.length)
    for (let i = 0; i < this.activeYBuffers.length; i++) {
      yOutputs[i] = this.activeYBuffers[i].getValue(immutable)
    }

    return {
      metadata: this.metadata,
      x: this.activeXBuffer.getValue(immutable),
      y: yOutputs
    }
  }

  async getDatasetCount (file) {
    const mr = this.options.maxRows
    this.options.maxRows = 1
    const data = await this.parse(file)
    this.options.maxRows = mr
    return data.y.length
  }

  #processLine (line, xBuffer, yBuffers, outResult, pool) {
    if (this.isHeaderSection) {
      const handled = this.parseHeaderLine(line)
      if (handled) {
        return BaseParser.status.no_data
      }
      // If a line wasn't parsed as a header, the header section has ended
      this.isHeaderSection = false
    }

    const status = this.parseLine(line, outResult)
    if (status === BaseParser.status.valid_data) {
      const currentYCount = outResult.parsedCount

      if (this.expectedYCount === -1) {
        this.expectedYCount = currentYCount
      } else if (currentYCount !== this.expectedYCount) {
        if (this.options.mismatchedColumnStrategy === "throw") {
          throw new Error(`Mismatched column count encountered. Expected ${this.expectedYCount} columns but found ${currentYCount}.`)
        }
      }

      xBuffer.push(outResult.x)

      // Expand y buffers array if the file contains more columns
      while (yBuffers.length < currentYCount) {
        yBuffers.push(pool.requestBuffer())
      }

      const rawYArray = outResult.yValues.array
      for (let i = 0; i < currentYCount; i++) {
        yBuffers[i].push(rawYArray[i])
      }

      // Pad remaining buffers if this line happened to have fewer columns than previous lines
      // and opts.mismatchedColumnStrategy is not "throw"
      for (let i = currentYCount; i < yBuffers.length; i++) {
        yBuffers[i].push(0)
      }
    }
    return status
  }

  parseHeaderLine (line) {
    return false
  }

  parseLine (line, outResult) {
    throw new Error("parseLine() must be implemented by subclass")
  }
}


// XyParser is a generic parser to read tabulated data.
// This is a little messy, but we get a fairly significant performance bump by
// avoiding regex
class XyParser extends TextParser {
  validateOptions (options = {}) {
    const opts = {
      xMin: options.xMin !== undefined ? options.xMin : -Infinity,
      xMax: options.xMax !== undefined ? options.xMax : Infinity,
      xColumnIndex: options.xColumnIndex,
      yColumnIndices: options.yColumnIndices,
      separator: options.separator,
      invalidNumericStrategy: options.invalidNumericStrategy || "throw",
      ...super.validateOptions(options)
    }

    if (
      typeof opts.xMin !== 'number' || typeof opts.xMax !== 'number' ||
      Number.isNaN(opts.xMin) || Number.isNaN(opts.xMax) || opts.xMin >= opts.xMax
    ) {
      throw new TypeError("xMin must be less than xMax")
    }

    if (
      typeof opts.xColumnIndex !== 'undefined' &&
      (!Number.isInteger(opts.xColumnIndex) || opts.xColumnIndex < 0)
    ) {
      throw new TypeError("xColumnIndex must be a non-negative integer")
    }

    if (
      typeof opts.yColumnIndices !== 'undefined' &&
      (!Array.isArray(opts.yColumnIndices) || opts.yColumnIndices.some(i => !Number.isInteger(i) || i < 0))
    ) {
      throw new TypeError("yColumnIndices must be an array of non-negative integers")
    }

    if (
      typeof opts.separator !== 'undefined' &&
      (typeof opts.separator !== 'string' || [...opts.separator].length !== 1)
    ) {
      throw new TypeError("separator must be a single character string")
    }

    const allowedStrategies = ["throw", "pad-0"]
    if (!allowedStrategies.includes(opts.invalidNumericStrategy)) {
      throw new RangeError('invalidNumericStrategy must be either "throw" or "pad-0"')
    }

    return opts
  }

  parseHeaderLine (line) {
    const len = line.length
    let i = 0

    const separator = this.options.separator

    // Skip leading whitespace
    while (i < len && (line[i] === ' ' || line[i] === '\t' || line[i] === '\r' || line[i] === '\n')) {
      i++
    }

    // Empty lines or comment lines are skipped
    if (i >= len || line[i] === '#') {
      return true
    }

    const startX = i
    if (separator !== undefined) {
      while (i < len && line[i] !== separator && line[i] !== '\r' && line[i] !== '\n') {
        i++
      }
    } else {
      while (i < len && line[i] !== ' ' && line[i] !== '\t' && line[i] !== ',') {
        i++
      }
    }

    const token = line.substring(startX, i)
    const x = Number(token)

    // If the first column is not a number, we assume it is a header
    if (isNaN(x)) {
      return true
    }

    return false
  }

  parseLine (line, outResult) {
    const len = line.length
    let i = 0

    const opts = this.options

    const xMin = opts.xMin
    const xMax = opts.xMax
    const separator = opts.separator

    // If undefined we assume the first column is the x column and all subsequent columns
    // are different y datasets
    const targetXIdx = opts.xColumnIndex !== undefined ? opts.xColumnIndex : 0
    const targetYIdxs = opts.yColumnIndices

    // Ignore leading whitespace
    while (i < len && (line[i] === ' ' || line[i] === '\t' || line[i] === '\r' || line[i] === '\n')) {
      i++
    }

    // Empty lines or lines starting with # are ignored
    if (i >= len || line[i] === '#') {
      return BaseParser.status.no_data
    }

    let currentColumnIdx = 0
    let x = null
    outResult.yValues.reset()
    let yCount = 0

    // Loop through all characters on this line
    while (i < len) {
      // Store where this column starts
      const startToken = i

      // Find the next character that is a column separator
      if (separator !== undefined) {
        while (i < len && line[i] !== separator && line[i] !== '\n' && line[i] !== '\r') {
          i++
        }
      } else {
        while (i < len && line[i] !== ' ' && line[i] !== '\t' && line[i] !== ',' && line[i] !== '\n' && line[i] !== '\r') {
          i++
        }
      }

      // We have the text representation of a data cell now, we need to check if we need to
      // store it and convert to a number
      if (i !== startToken) {
        // Evaluate token if it matches our targeted layout layout positions
        if (currentColumnIdx === targetXIdx) {
          x = Number(line.substring(startToken, i))
        } else {
          // If explicit Y indexes are passed, check inclusion. Otherwise, capture everything past X
          const isTargetY = targetYIdxs !== undefined
            ? targetYIdxs.includes(currentColumnIdx)
            : currentColumnIdx > targetXIdx

          if (isTargetY) {
            const yVal = Number(line.substring(startToken, i))

            if (isNaN(yVal) || !isFinite(yVal)) {
              if (opts.invalidNumericStrategy === "throw") {
                throw new Error(`Invalid numerical value encountered: "${line.substring(startToken, i)}"`)
              }
              outResult.yValues.push(0)
            } else {
              outResult.yValues.push(yVal)
            }
            yCount++
          }
        }
        currentColumnIdx++
      }

      // Skip column separators
      if (separator !== undefined) {
        while (i < len && line[i] === separator) {
          i++
        }
      } else {
        while (i < len && (line[i] === ' ' || line[i] === '\t' || line[i] === ',')) {
          i++
        }
      }

      // Check for row end or trailing comments
      if (i >= len || line[i] === '\n' || line[i] === '\r' || line[i] === '#') {
        break
      }
    }

    if (x === null) {
      return BaseParser.status.no_data
    }

    if (isNaN(x) || x < xMin) {
      return BaseParser.status.no_data
    }

    if (x > xMax) {
      return BaseParser.status.finished
    }

    if (yCount === 0) {
      return BaseParser.status.no_data
    }

    outResult.x = x
    outResult.parsedCount = yCount
    return BaseParser.status.valid_data
  }
}

// This is a parser specific to PDFGetX3 .gr files
class GrParser extends XyParser {
  dataType = {
    id: "gr",
    xlab: "r / Å",
    ylab: "G(r)"
  }

  constructor (...args) {
    super(...args)
    this.inDataSection = false
  }

  validateOptions (options) {
    // Override any options to use required values for these files
    const opts = {
      ...options,
      xColumnIndex: 0,
      yColumnIndices: [1],
      separator: " "
    }
    return super.validateOptions(opts)
  }

  parseHeaderLine (line) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("[")) {
      return true
    }

    if (trimmed.includes("start data")) {
      this.inDataSection = true
      return true
    }

    if (!this.inDataSection) {
      if (trimmed.includes("=")) {
        const pairs = trimmed.split(/\s+(?=\S+=)/)

        for (const pair of pairs) {
          if (pair.includes("=") && !pair.startsWith("#")) {
            const [key, val] = pair.split("=")
            const cleanVal = val.split(/\s+\(/)[0].trim()
            this.metadata[key.trim()] = cleanVal
          }
        }
      }
      return true
    }

    if (trimmed.startsWith("#")) {
      return true
    }

    return false
  }
}

// ParserFactory registers parsers and matches files to an appropriate parser
export class ParserFactory {
  static #registry = new Map()

  static register (extensions, ParserClass) {
    for (const ext of extensions) {
      this.#registry.set(ext.toLowerCase(), ParserClass)
    }
  }

  static getParserForFile (fileName, options) {
    const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
    const ParserClass = this.#registry.get(ext)
    if (!ParserClass) {
      throw new Error(`Unsupported file extension: ${ext}`)
    }
    return new ParserClass(options)
  }
}

ParserFactory.register([".xy", ".csv", ".dat", ".txt"], XyParser)
ParserFactory.register([".gr"], GrParser)
