import { ExpandableBuffer, BufferPool } from "./util.js"

// We use a class based system to parse data files so that it is easy to extend support
// to additional file types. All parses must extend from BaseParser. They should at
// minimum implement parseLine. parseHeaderLine can optionally implemented to
// read metadata and store it in `this.metadata`. dataType should be set if known,
// and is used to set the axis titles for the main plots.
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

  constructor () {
    this.metadata = {}
    this.isHeaderSection = true
    this.expectedYCount = -1
    this.activeXBuffer = null
    this.activeYBuffers = null
    this.activePool = null
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

  async parseStream (fileStream, options = {}) {
    const reader = fileStream.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""

    // Assign clean internal defaults to ensure properties exist inside hot loops
    const opts = {
      bufferPool: options.bufferPool || new BufferPool(),
      xMin: options.xMin !== undefined ? options.xMin : -Infinity,
      xMax: options.xMax !== undefined ? options.xMax : Infinity,
      xColumnIndex: undefined,
      yColumnIndices: undefined,
      separator: options.separator,
      mismatchedColumnStrategy: options.mismatchedColumnStrategy || "throw",
      invalidNumericStrategy: options.invalidNumericStrategy || "throw",
      immutable: !!options.immutable,
      maxRows: options.maxRows !== undefined ? options.maxRows : Infinity
    }

    const pool = opts.bufferPool
    this.activePool = pool
    this.activeXBuffer = pool.requestBuffer()
    this.activeYBuffers = [pool.requestBuffer()]

    this.expectedYCount = -1

    // Container used to pass values back from parseLine
    // without creating new object allocations on every single line.
    const outResult = { x: 0, yValues: new ExpandableBuffer(Float64Array, 16), parsedCount: 0 }

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
              const status = this.#processLine(line, this.activeXBuffer, this.activeYBuffers, outResult, pool, opts)

              if (status === BaseParser.status.valid_data) {
                validRowsParsed++
                if (validRowsParsed >= opts.maxRows) {
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
            this.#processLine(buffer, this.activeXBuffer, this.activeYBuffers, outResult, pool, opts)
          }
          break
        }
      }
    } finally {
      // Ensure the reader lock is safely released regardless of how we exited
      reader.releaseLock()
    }

    const immutable = opts.immutable
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

  async getDatasetCount (fileStream, options = {}) {
    const data = await this.parseStream(fileStream, {
      ...options,
      maxRows: 1
    })
    return data.y.length
  }

  #processLine (line, xBuffer, yBuffers, outResult, pool, opts) {
    if (this.isHeaderSection) {
      const handled = this.parseHeaderLine(line, opts)
      if (handled) {
        return BaseParser.status.no_data
      }
      // If a line wasn't parsed as a header, the header section has ended
      this.isHeaderSection = false
    }

    // outResult container avoids repeated allocations
    const status = this.parseLine(line, outResult, opts)
    if (status === BaseParser.status.valid_data) {
      const currentYCount = outResult.parsedCount

      if (this.expectedYCount === -1) {
        this.expectedYCount = currentYCount
      } else if (currentYCount !== this.expectedYCount) {
        if (opts.mismatchedColumnStrategy === "throw") {
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

  parseHeaderLine (line, opts) {
    return false
  }

  parseLine (line, outResult, opts) {
    throw new Error("parseLine() must be implemented by subclass")
  }
}


// XyParser is a generic parser to read tabulated data.
// This is a little messy, but we get a fairly significant performance bump by
// avoiding regex
class XyParser extends BaseParser {
  parseHeaderLine (line, opts) {
    const len = line.length
    let i = 0

    const separator = opts?.separator

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

  parseLine (line, outResult, opts) {
    const len = line.length
    let i = 0

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

  constructor () {
    super()
    this.inDataSection = false
  }

  parseHeaderLine (line) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith("[")) {
      return true
    }

    if (trimmed.startsWith("#### start data")) {
      this.inDataSection = true
      return true
    }

    if (!this.inDataSection) {
      if (trimmed.includes("=") && !trimmed.startsWith("#")) {
        const [key, val] = trimmed.split("=")
        this.metadata[key.trim()] = val.trim()
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

  static getParserForFile (fileName) {
    const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
    const ParserClass = this.#registry.get(ext)
    if (!ParserClass) {
      throw new Error(`Unsupported file extension: ${ext}`)
    }
    return new ParserClass()
  }
}

ParserFactory.register([".xy", ".csv", ".dat", ".txt"], XyParser)
ParserFactory.register([".gr"], GrParser)
