import { ExpandableBuffer } from "../../util.js"
import { BaseParser } from "../BaseParser.js"

// TextParser reads a plain text file line by line
// subclasses MUST implement parseLine to actually import data
// subclasses may optionally implement parseHeaderLine to skip or read
// metadata from headers
// If a subclass takes options, then validateOptions should also be implemented
export class TextParser extends BaseParser {
  static status = {
    no_data: 0,
    valid_data: 1,
    finished: 2
  }

  constructor (options = {}) {
    super(options)
    this.isHeaderSection = true
    this.expectedYCount = -1
  }

  validateOptions (options = {}) {
    const opts = {
      maxRows: options.maxRows !== undefined ? options.maxRows : Infinity,
      ...super.validateOptions(options)
    }

    if (opts.maxRows !== Infinity) {
      if (!Number.isInteger(opts.maxRows) || opts.maxRows <= 0) {
        throw new TypeError("maxRows must be a positive integer or Infinity")
      }
    }

    return opts
  }

  async parse (file) {
    const fileStream = file.stream()
    const reader = fileStream.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""

    const xBuffer = this.requestBuffer()
    const yBuffers = [this.requestBuffer()]

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
              const status = this.#processLine(line, xBuffer, yBuffers, outResult)

              if (status === TextParser.status.valid_data) {
                validRowsParsed++
                if (validRowsParsed >= this.options.maxRows) {
                  shouldBreak = true
                  break
                }
              }

              if (status === TextParser.status.finished) {
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
            this.#processLine(buffer, xBuffer, yBuffers, outResult)
          }
          break
        }
      }
    } finally {
      reader.releaseLock()
    }

    const immutable = this.options.immutable
    const yOutputs = new Array(yBuffers.length)
    for (let i = 0; i < yBuffers.length; i++) {
      yOutputs[i] = yBuffers[i].getValue(immutable)
    }

    return {
      metadata: this.metadata,
      x: xBuffer.getValue(immutable),
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

  #processLine (line, xBuffer, yBuffers, outResult) {
    if (this.isHeaderSection) {
      const handled = this.parseHeaderLine(line)
      if (handled) {
        return TextParser.status.no_data
      }
      // If a line wasn't parsed as a header, the header section has ended
      this.isHeaderSection = false
    }

    const status = this.parseLine(line, outResult)
    if (status === TextParser.status.valid_data) {
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
        yBuffers.push(this.requestBuffer())
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
