import { BaseParser } from "../BaseParser.js"

import h5wasm from "h5wasm"

const metadataDiscoveryPaths = ["/entry/instrument", "/entry/instrument/name", "/entry/sample", "/entry/user"]

// This is very preliminary, but it seems to work in simple cases

export class NexusParser extends BaseParser {
  validateOptions (options = {}) {
    return {
      dataPath: options.dataPath || null,
      ...super.validateOptions(options)
    }
  }

  async #openVirtualFile (fileObj) {
    const { FS } = await h5wasm.ready

    const arrayBuffer = await fileObj.arrayBuffer()
    const filename = `memfile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.nxs`

    FS.writeFile(filename, new Uint8Array(arrayBuffer))
    const h5file = new h5wasm.File(filename, "r")

    return { h5file, filename }
  }

  async getDatasetCount (fileObj) {
    const { FS } = await h5wasm.ready
    const { h5file, filename } = await this.#openVirtualFile(fileObj)

    try {
      const nxDataPath = this.options.dataPath || this.#findDefaultDataPath(h5file)
      const dataGroup = h5file.get(nxDataPath)
      if (!dataGroup) {
        return 0
      }

      const yNames = this.#resolveYNames(h5file, dataGroup, nxDataPath)
      return yNames.length
    } finally {
      h5file.close()
      try {
        FS.unlink(filename)
      } catch (e) {}
    }
  }

  async parse (fileObj) {
    const { FS } = await h5wasm.ready
    const { h5file, filename } = await this.#openVirtualFile(fileObj)

    try {
      this.#extractGlobalMetadata(h5file)
      const nxDataPath = this.options.dataPath || this.#findDefaultDataPath(h5file)
      const dataGroup = h5file.get(nxDataPath)

      if (!dataGroup) {
        throw new Error(`Target structural data path "${nxDataPath}" not found.`)
      }

      const xName = this.#resolveXName(dataGroup)
      const yNames = this.#resolveYNames(h5file, dataGroup, nxDataPath)

      const xDataset = h5file.get(`${nxDataPath}/${xName}`)
      const primaryYName = yNames[0] || null
      const yDataset = primaryYName ? h5file.get(`${nxDataPath}/${primaryYName}`) : null

      this.dataType = {
        id: h5file.attrs["program_name"]?.value || "nexus_file",
        xlab: this.#getLabel(xDataset, xName, "x / unknown"),
        ylab: this.#getLabel(yDataset, primaryYName, "intensity / unknown")
      }

      let xLimit = xDataset && xDataset.shape ? xDataset.shape.reduce((a, b) => a * b, 1) : 0
      if (this.options.maxRows < xLimit) {
        xLimit = this.options.maxRows
      }

      let xOutput = new Float64Array(0)
      if (xDataset && xLimit > 0) {
        const xValues = xDataset.value
        xOutput = xLimit === xValues.length ? Float64Array.from(xValues) : Float64Array.from(xValues.subarray(0, xLimit))
      }

      const yOutputs = new Array(yNames.length)

      for (let i = 0; i < yNames.length; i++) {
        const name = yNames[i]
        const dset = h5file.get(`${nxDataPath}/${name}`)

        if (dset) {
          const yValues = dset.value
          let yLimit = dset.shape ? dset.shape.reduce((a, b) => a * b, 1) : 0

          if (yLimit !== xLimit && this.options.mismatchedColumnStrategy === "throw") {
            throw new Error(`Mismatched row size: X dataset contains ${xLimit} items but Y dataset "${name}" contains ${yLimit}.`)
          }

          const limit = Math.min(xLimit, yLimit)

          if (limit === yLimit && limit === xLimit) {
            yOutputs[i] = Float64Array.from(yValues)
          } else {
            const destArray = new Float64Array(xLimit)
            destArray.set(yValues.subarray(0, limit), 0)
            yOutputs[i] = destArray
          }
        } else {
          yOutputs[i] = new Float64Array(xLimit)
        }
      }

      return {
        metadata: this.metadata,
        x: xOutput,
        y: yOutputs
      }
    } finally {
      h5file.close()
      try {
        FS.unlink(filename)
      } catch (e) {}
    }
  }

  #resolveXName(dataGroup) {
    const axesAttr = this.#getAttrValue(dataGroup, "axes")
    if (axesAttr) {
      if (Array.isArray(axesAttr)) {
        const validAxes = axesAttr.filter(axis => axis && axis !== ".")
        if (validAxes.length > 0) {
          return validAxes.length === 1 ? validAxes[0] : validAxes[0]
        }
      } else if (typeof axesAttr === "string" && axesAttr !== ".") {
        return axesAttr
      }
    }
    return "x"
  }

  #resolveYNames (h5file, dataGroup, nxDataPath) {
    const signal = this.#getAttrValue(dataGroup, "signal")
    const auxSignals = this.#getAttrValue(dataGroup, "auxiliary_signals")
    const xName = this.#resolveXName(dataGroup)

    let yNames = []
    if (signal) {
      yNames.push(signal)
    }
    if (auxSignals) {
      if (Array.isArray(auxSignals)) {
        yNames.push(...auxSignals)
      } else {
        yNames.push(auxSignals)
      }
    }

    if (yNames.length === 0) {
      yNames = dataGroup.keys().filter(key => {
        if (key === xName) {
          return false
        }
        const node = h5file.get(`${nxDataPath}/${key}`)
        return node && node.type === "Dataset"
      })
    }

    return yNames
  }

  #findDefaultDataPath (h5file) {
    let entryName = "entry"
    if (h5file.attrs["default"]) {
      entryName = h5file.attrs["default"].value
    }

    const entryGroup = h5file.get(entryName)
    if (!entryGroup) {
      return "/entry/data"
    }

    let dataName = "data"
    if (entryGroup.attrs["default"]) {
      dataName = entryGroup.attrs["default"].value
    }

    return `/${entryName}/${dataName}`.replace(/\/+/g, "/")
  }

  #extractGlobalMetadata (h5file) {
    this.metadata = {}
    for (const key of Object.keys(h5file.attrs)) {
      const attr = h5file.attrs[key]
      if (attr && typeof attr.value !== "object") {
        this.metadata[key] = attr.value
      }
    }

    for (const path of metadataDiscoveryPaths) {
      const parts = path.split("/").filter(Boolean)
      let currentGroup = h5file
      let isValidPath = true

      for (const part of parts) {
        if (!currentGroup || typeof currentGroup.keys !== "function" || !currentGroup.keys().includes(part)) {
          isValidPath = false
          break
        }
        currentGroup = currentGroup.get(part)
      }

      if (!isValidPath || !currentGroup) {
        continue
      }

      const node = currentGroup
      if (node.type !== "Group") {
        if (node.type === "Dataset" && typeof node.value !== "object") {
          this.metadata[path.split("/").pop()] = node.value
        }
        continue
      }

      for (const childKey of node.keys()) {
        const child = node.get(childKey)
        if (child && child.type === "Dataset" && (child.shape.length === 0 || child.shape <= 1)) {
          if (typeof child.value !== "object") {
            this.metadata[childKey] = child.value
          }
        }
      }
    }
  }

  #getLabel (dataset, fallbackName, absoluteFallback) {
    if (!dataset) {
      return absoluteFallback
    }
    const longName = this.#getAttrValue(dataset, "long_name")
    if (longName) {
      return longName
    }

    const units = this.#getAttrValue(dataset, "units")
    if (units) {
      return `${fallbackName} (${units})`
    }

    return fallbackName || absoluteFallback
  }

  #getAttrValue (node, attrName) {
    if (!node || !node.attrs[attrName]) {
      return null
    }
    const attr = node.attrs[attrName]
    if (Array.isArray(attr.value) && attr.value.length === 1) {
      return attr.value
    }
    return attr.value
  }
}
