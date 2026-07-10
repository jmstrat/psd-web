import { TextParser } from "../TextParser.js"

// XyParser is a generic parser to read tabulated data.
// This is a little messy, but we get a fairly significant performance bump by
// avoiding regex
export class XyParser extends TextParser {
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
      return TextParser.status.no_data
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
      return TextParser.status.no_data
    }

    if (isNaN(x) || x < xMin) {
      return TextParser.status.no_data
    }

    if (x > xMax) {
      return TextParser.status.finished
    }

    if (yCount === 0) {
      return TextParser.status.no_data
    }

    outResult.x = x
    outResult.parsedCount = yCount
    return TextParser.status.valid_data
  }
}
