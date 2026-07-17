import { TextParser } from "../TextParser.js"

// XyParser is a generic parser to read tabulated data.
// This is a little messy, but we get a fairly significant performance bump by
// avoiding regex
export class XyParser extends TextParser {
  #rowsSkipped = 0

  validateOptions (options = {}) {
    const opts = {
      xMin: options.xMin !== undefined ? options.xMin : -Infinity,
      xMax: options.xMax !== undefined ? options.xMax : Infinity,
      xColumnIndex: options.xColumnIndex,
      yColumnIndices: options.yColumnIndices,
      skipRows: options.skipRows,
      separator: options.separator,
      decimalSeparator: options.decimalSeparator || '.',
      thousandsSeparator: options.thousandsSeparator || '',
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
      typeof opts.skipRows !== 'undefined' &&
      (!Number.isInteger(opts.skipRows) || opts.skipRows < 0)
    ) {
      throw new TypeError("skipRows must be undefined or a non-negative integer")
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

    if (opts.decimalSeparator === opts.thousandsSeparator) {
      throw new Error("Decimal and thousands separators cannot be the same character")
    }

    opts.hasCustomNumberSeparators = (
      opts.decimalSeparator !== '.' ||
      opts.thousandsSeparator !== ''
    )

    return opts
  }

  #parseNumericToken (tokenStr) {
    tokenStr = tokenStr.trim()
    const len = tokenStr.length
    if (len === 0) {
      return NaN
    }

    const opts = this.options
    const decSep = opts.decimalSeparator
    const thSep = opts.thousandsSeparator

    let needsSanitation = false
    if (opts.hasCustomNumberSeparators) {
      for (let j = 0; j < len; j++) {
        const char = tokenStr[j]
        if (char === decSep || (thSep !== '' && char === thSep)) {
          needsSanitation = true
          break
        }
      }
    }

    if (!needsSanitation) {
      return Number(tokenStr)
    }

    let constructedStr = ''
    for (let j = 0; j < len; j++) {
      const char = tokenStr[j]
      if (char === decSep) {
        constructedStr += '.'
      } else if (thSep !== '' && char === thSep) {
        continue
      } else {
        constructedStr += char
      }
    }

    return Number(constructedStr)
  }

  parseHeaderLine (line) {
    if (this.options.skipRows !== undefined) {
      if (this.#rowsSkipped < this.options.skipRows) {
        this.#rowsSkipped++
        return true
      }
      return false
    }

    const len = line.length
    let i = 0

    const separator = this.options.separator

    // Skip leading whitespace
    while (i < len && (line[i] === ' ' || line[i] === '\t')) {
      i++
    }

    // Empty lines or comment lines are skipped
    if (i >= len || line[i] === '#') {
      return true
    }

    const startX = i
    if (separator !== undefined) {
      while (i < len && line[i] !== separator) {
        i++
      }
    } else {
      while (i < len && line[i] !== ' ' && line[i] !== '\t' && line[i] !== ',') {
        i++
      }
    }

    const token = line.substring(startX, i)
    const x = this.#parseNumericToken(token)

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
    while (i < len && (
      line[i] === ' ' ||
      line[i] === '\t'
    )) {
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
        while (i < len && line[i] !== separator) {
          i++
        }
      } else {
        while (
          i < len && line[i] !== ' ' && line[i] !== '\t' && line[i] !== ','
        ) {
          i++
        }
      }

      // We have the text representation of a data cell now, we need to check if we need to
      // store it and convert to a number
      const token = line.substring(startToken, i)
      // Evaluate token if it matches our targeted layout layout positions
      if (currentColumnIdx === targetXIdx) {
        x = this.#parseNumericToken(token)
      } else {
        // If explicit Y indexes are passed, check inclusion. Otherwise, capture everything past X
        const isTargetY = targetYIdxs !== undefined
          ? targetYIdxs.includes(currentColumnIdx)
          : currentColumnIdx > targetXIdx

        if (isTargetY) {
          const yVal = this.#parseNumericToken(token)

          if (isNaN(yVal) || !isFinite(yVal)) {
            if (opts.invalidNumericStrategy === "throw") {
              throw new Error(`Invalid numerical value encountered: "${token}"`)
            }
            outResult.yValues.push(0)
          } else {
            outResult.yValues.push(yVal)
          }
          yCount++
        }
      }
      currentColumnIdx++


      // Skip column separators
      if (separator !== undefined) {
        if (i < len && line[i] === separator) {
          i++
        }
      } else {
        while (i < len && (line[i] === ' ' || line[i] === '\t' || line[i] === ',')) {
          i++
        }
      }

      // Skip whitespace
      while (i < len && (line[i] === ' ' || line[i] === '\t')) {
        i++
      }

      const targetSep = separator === undefined ? ',' : separator
      if (
        (targetSep !== ' ' && targetSep !== '\t') &&
        (i < len && line[i] === targetSep)
       ) {
        i++ // Skip past exactly one separator
      }

      // Check for row end or trailing comments
      if (i >= len || line[i] === '#') {
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
