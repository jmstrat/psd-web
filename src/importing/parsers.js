import { ExpandableBuffer } from "@/util.js"

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
  }

  async parseStream (fileStream, options = {}) {
    const reader = fileStream.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""

    const xBuffer = options.xBuffer || new ExpandableBuffer(Float64Array, 6000)
    const yBuffer = options.yBuffer || new ExpandableBuffer(Float64Array, 6000)

    // Ensure the buffers are empty even if passed as an argument
    xBuffer.reset()
    yBuffer.reset()

    const xMin = options.xMin !== undefined ? options.xMin : -Infinity
    const xMax = options.xMax !== undefined ? options.xMax : Infinity

    // Container used to pass values back from parseLine
    // without creating new object allocations on every single line.
    const outResult = { x: 0, y: 0 }

    let shouldBreak = false

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
              const status = this.#processLine(line, xBuffer, yBuffer, outResult, xMin, xMax)

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
            this.#processLine(buffer, xBuffer, yBuffer, outResult, xMin, xMax)
          }
          break
        }
      }
    } finally {
      // Ensure the reader lock is safely released regardless of how we exited
      reader.releaseLock()
    }

    return {
      metadata: this.metadata,
      x: xBuffer.getValue(!!options.immutable),
      y: yBuffer.getValue(!!options.immutable)
    }
  }

  #processLine (line, xBuffer, yBuffer, outResult, xMin, xMax) {
    if (this.isHeaderSection) {
      const handled = this.parseHeaderLine(line)
      if (handled) {
        return BaseParser.status.no_data
      }
      // If a line wasn't parsed as a header, the header section has ended
      this.isHeaderSection = false
    }

    // outResult container avoids repeated allocations
    const status = this.parseLine(line, outResult, xMin, xMax)
    if (status === BaseParser.status.valid_data) {
      xBuffer.push(outResult.x)
      yBuffer.push(outResult.y)
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
class XyParser extends BaseParser {
  parseLine (line, outResult, xMin, xMax) {
    const len = line.length
    let i = 0

    while (i < len && (line[i] === ' ' || line[i] === '\t' || line[i] === '\r' || line[i] === '\n')) {
      i++
    }

    if (i >= len || line[i] === '#') {
      return BaseParser.status.no_data
    }

    const startX = i
    while (i < len && line[i] !== ' ' && line[i] !== '\t' && line[i] !== ',') {
      i++
    }
    if (i === startX) {
      return BaseParser.status.no_data
    }

    const x = Number(line.substring(startX, i))

    if (isNaN(x) || x < xMin) {
      return BaseParser.status.no_data
    }

    if (x > xMax) {
      return BaseParser.status.finished
    }

    // Skip horizontal column separators
    while (i < len && (line[i] === ' ' || line[i] === '\t' || line[i] === ',')) {
      i++
    }

    // Y token column
    const startY = i
    while (i < len && line[i] !== ' ' && line[i] !== '\t' && line[i] !== ',' && line[i] !== '\n' && line[i] !== '\r') {
      i++
    }
    if (i === startY) {
      return BaseParser.status.no_data
    }

    const y = Number(line.substring(startY, i))

    if (isNaN(y) || !isFinite(y)) {
      return BaseParser.status.no_data
    }

    outResult.x = x
    outResult.y = y
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
      throw new Error(`Unsupported file extension: ${ext}`);
    }
    return new ParserClass()
  }
}

ParserFactory.register([".xy"], XyParser)
ParserFactory.register([".gr"], GrParser)
