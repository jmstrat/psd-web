import { BufferPool } from "../util.js"

// We use a class based system to parse data files so that it is easy to extend support
// to additional file types. All parsers must extend from BaseParser. They should at
// minimum implement parse(). dataType should be set if known, and is used to set the
// axis titles for the main plots.
export class BaseParser {
  dataType = {
    id: "unknown",
    x: { label: "x", unit: null },
    y: { label: "intensity", unit: null }
  }

  constructor (options = {}) {
    this.metadata = {}
    this.activeBuffers = new Set()
    this.activePool = null

    this.options = this.validateOptions(options)
    const pool = this.options.bufferPool
    this.activePool = pool
  }

  releaseBuffers () {
    if (!this.activePool) {
      return
    }
    this.activePool.returnBuffers(Array.from(this.activeBuffers))
    this.activePool = null
    this.activeBuffers.clear()
  }

  requestBuffer () {
    const buffer = this.activePool.requestBuffer()
    this.activeBuffers.add(buffer)
    return buffer
  }

  validateOptions (options = {}) {
    const opts = {
      bufferPool: options.bufferPool || new BufferPool(),
      mismatchedColumnStrategy: options.mismatchedColumnStrategy || "throw",
      immutable: !!options.immutable
    }

    if (!(opts.bufferPool instanceof BufferPool)) {
      throw new TypeError("bufferPool must be an instance of BufferPool")
    }

    const allowedStrategies = ["throw", "pad-0"]
    if (!allowedStrategies.includes(opts.mismatchedColumnStrategy)) {
      throw new TypeError('mismatchedColumnStrategy must be either "throw" or "pad-0"')
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
