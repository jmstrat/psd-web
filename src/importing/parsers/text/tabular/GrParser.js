import { XyParser } from "./XyParser.js"

// This is a parser specific to PDFGetX3 .gr files
export class GrParser extends XyParser {
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
