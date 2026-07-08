import ModuleFactory from "@wasm/psd.js"

const Module = await ModuleFactory()

// This module serves as a helper to manage memory for the wasm module

class WasmBuffer {
  constructor (sizeOrData) {
    const isArray = sizeOrData instanceof Float64Array || Array.isArray(sizeOrData)
    this.size = isArray ? sizeOrData.length : sizeOrData
    this.ptr = Module._malloc(this.size * Float64Array.BYTES_PER_ELEMENT)

    if (isArray) {
      this.set(sizeOrData)
    }
  }

  set (data) {
    const view = new Float64Array(Module.HEAPF64.buffer, this.ptr, this.size)
    view.set(data)
  }

  get () {
    return new Float64Array(Module.HEAPF64.buffer, this.ptr, this.size).slice()
  }

  free () {
    if (this.ptr) {
      Module._free(this.ptr)
      this.ptr = null
    }
  }
}

export default class WasmRunner {
  #buffers = new Map()

  allocate (schema) {
    for (const [key, definition] of Object.entries(schema)) {
      if (this.#buffers.has(key)) {
        this.#buffers.get(key).free()
      }
      this.#buffers.set(key, new WasmBuffer(definition))
    }
    return this
  }

  run (executionCallback) {
    const pointers = {}
    for (const [key, buffer] of this.#buffers.entries()) {
      pointers[key] = buffer.ptr
    }

    executionCallback(pointers, Module)
    return this
  }

  read (key) {
    const buffer = this.#buffers.get(key)
    if (!buffer) throw new Error(`Buffer '${key}' is not allocated.`)
    return buffer.get()
  }

  free (...keys) {
    if (keys.length > 0) {
      for (const key of keys) {
        if (this.#buffers.has(key)) {
          this.#buffers.get(key).free()
          this.#buffers.delete(key)
        }
      }
    } else {
      for (const buffer of this.#buffers.values()) {
        buffer.free()
      }
      this.#buffers.clear()
    }
    return this
  }
}
