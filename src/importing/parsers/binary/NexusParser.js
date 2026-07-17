import { BaseParser } from "../BaseParser.js"

import h5wasm from "h5wasm"

const metadataDiscoveryPaths = [
  "/entry/instrument",
  "/entry/sample",
  "/entry/user"
]

// dataPath: Explicitly targets a specific HDF5 group path for data extraction (default tries to automatically find the main data)
// primaryDataset: Explicitly defines the name of the main dataset containing the intensity data (default uses the group's default signal attribute)
// squeeze: Eliminates dimensions of size one from extracted data arrays
// xMin / xMax: Limits the X range that is read
// slice: Configures multidimensional cuts by dataset name or by axis name (see below)

/**
  Slice by Axis Name:
    slice: { posX: 0, posY: 12 }
  Slice by Dataset Name:
    slice: { intensity: [0, ":", 12] }
  Fallback:
    Any dimension not matched by axis or dataset name automatically
    defaults to 0 if it is not the x axis dimension
 */
export class NexusParser extends BaseParser {
  validateOptions (options = {}) {
    if (options.slice && typeof options.slice !== "object") {
      throw new Error("slice must be an object")
    }

    if (options.squeeze !== undefined && typeof options.squeeze !== "boolean") {
      throw new Error("squeeze must be a boolean")
    }

    if (options.slice) {
      for (const [key, val] of Object.entries(options.slice)) {
        if (Array.isArray(val)) {
          for (const part of val) {
            if (part !== ":" && !Number.isInteger(part)) {
              throw new Error(`Slice array for "${key}" must contain only integers or ":"`)
            }
          }
        } else if (val !== ":" && !Number.isInteger(val) && typeof val !== "string") {
          throw new Error(`Slice value for "${key}" must be an integer, a string axis index, or a range array`)
        }
      }
    }

    return {
      dataPath: options.dataPath || null,
      primaryDataset: options.primaryDataset || null,
      slice: options.slice || {},
      squeeze: options.squeeze ?? true,
      xMin: options.xMin !== undefined ? options.xMin : -Infinity,
      xMax: options.xMax !== undefined ? options.xMax : Infinity,
      ...super.validateOptions(options)
    }
  }

  async getDatasetCount (fileObj) {
    await this.#openVirtualFile(fileObj)

    try {
      const { group, path } = this.#resolveDataGroup()
      if (!group) {
        return 0
      }

      const primaryDatasetKey = this.#resolvePrimaryDataset(group, path)
      if (!primaryDatasetKey) {
        return 0
      }

      const yNames = this.#resolveYNames(group, primaryDatasetKey)
      return yNames.filter(name => {
        const dataset = this.file.get(`${path}/${name}`)
        return dataset !== null && dataset !== undefined
      }).length
    } finally {
      await this.#closeVirtualFile()
    }
  }

  async parse (fileObj) {
    await this.#openVirtualFile(fileObj)

    try {
      this.#extractGlobalMetadata()

      const data = this.#resolvePrimaryData()
      const x = this.#readXAxis(data)
      const y = this.#readYDatasets(data)
      this.dataType = this.#createDataType(data)

      return {
        metadata: this.metadata,
        x,
        y
      }
    } finally {
      await this.#closeVirtualFile()
    }
  }

  // ---- Virtual file system ----

  async #openVirtualFile (fileObj) {
    if (this.file) {
      throw new Error('File already open')
    }
    const { FS } = await h5wasm.ready
    FS.mkdir('/work')
    FS.mount(FS.filesystems.WORKERFS, { files: [fileObj] }, '/work')
    this.file = new h5wasm.File(`/work/${fileObj.name}`, 'r')
  }

  async #closeVirtualFile () {
    if (!this.file) {
      return
    }
    const { FS } = await h5wasm.ready
    this.file.close()
    FS.unmount('/work')
    FS.rmdir('/work')
    this.file = null
  }

  // ---- Main data reading steps ----

  #resolvePrimaryData () {
    const { group, path } = this.#resolveDataGroup()
    if (!group) {
      throw new Error("No NXdata group could be found")
    }

    const primaryDatasetKey = this.#resolvePrimaryDataset(group, path)
    if (!primaryDatasetKey) {
      throw new Error("No primary dataset could be found")
    }

    const primaryDataset = this.file.get(`${path}/${primaryDatasetKey}`)
    const axes = this.#resolveAxes(group, primaryDataset)

    return {
      group,
      path,
      primaryDatasetKey,
      primaryDataset,
      axes
    }
  }

  #readXAxis (data) {
    const { path, axes, primaryDataset } = data
    const xAxisIndex = this.#findXAxisDimension(axes, primaryDataset)
    const xName = axes[xAxisIndex]
    const xDataset = this.file.get(`${path}/${xName}`)

    if (!xDataset) {
      throw new Error(`Could not locate X axis dataset "${xName}"`)
    }

    const rawSlice = this.#resolveSliceForDataset(xName, xDataset, axes)
    const shape = xDataset.shape || []
    const baseSelection = this.#convertSliceToDataIndexes(rawSlice, shape)
    const targetDimension = this.#findXAxisDimension(axes, xDataset)

    const bounds = this.#findIndexLimitsForDataset(xDataset, baseSelection, targetDimension)
    data.bounds = bounds

    return this.#readDatasetVector(xName, xDataset, axes, bounds)
  }

  #readYDatasets (data) {
    const { group, path, primaryDatasetKey, axes, bounds } = data
    const yNames = this.#resolveYNames(group, primaryDatasetKey)
    const yOutputs = []

    for (const name of yNames) {
      const dataset = this.file.get(`${path}/${name}`)
      yOutputs.push(this.#readDatasetVector(name, dataset, axes, bounds))
    }

    return yOutputs
  }

  #createDataType (data) {
    const { primaryDataset, primaryDatasetKey, axes } = data
    const xAxisIndex = this.#findXAxisDimension(axes, primaryDataset)
    const xName = axes[xAxisIndex]
    const xDataset = this.file.get(`${data.path}/${xName}`)

    return {
      id: this.file.attrs["program_name"]?.value || "nexus_file",
      xlab: this.#getLabel(xDataset, xName, "x / unknown"),
      ylab: this.#getLabel(
        primaryDataset,
        primaryDatasetKey,
        "intensity / unknown"
      )
    }
  }

  // ---- HDF5 file searching ----

  #resolveDataGroup () {
    if (this.options.dataPath) {
      const group = this.file.get(this.options.dataPath)
      return { group, path: this.options.dataPath }
    }

    const defaultPath = this.#findDefaultDataPath()
    const defaultGroup = this.file.get(defaultPath)

    if (defaultGroup) {
      return { group: defaultGroup, path: defaultPath }
    }

    return this.#findNxDataGroup(this.file, "")
  }

  #findDefaultDataPath () {
    let entryName = "entry"

    const defaultEntry = this.file.attrs["default"]?.value

    if (defaultEntry) {
      entryName = defaultEntry
    }

    const entry = this.file.get(`/${entryName}`) || this.file.get(entryName)

    if (entry) {
      const defaultData = entry.attrs["default"]?.value
      if (defaultData) {
        return this.#joinPath(entryName, defaultData)
      }
    }

    const { path } = this.#findNxDataGroup(this.file, "")

    if (path) {
      return path
    }

    return "/entry/data"
  }

  #findNxDataGroup (node, path) {
    if (!node || typeof node.keys !== "function") {
      return { group: null, path: null }
    }

    if (node.attrs?.NX_class?.value === "NXdata") {
      return { group: node, path }
    }

    for (const key of node.keys()) {
      const child = node.get(key)
      const result = this.#findNxDataGroup(child, this.#joinPath(path, key))

      if (result.path) {
        return result
      }
    }

    return { group: null, path: null }
  }

  #resolvePrimaryDataset (dataGroup, path) {
    if (this.options.primaryDataset) {
      return this.options.primaryDataset
    }

    const primaryDatasetKey = this.#getAttrValue(dataGroup, "signal")
    if (primaryDatasetKey) {
      return Array.isArray(primaryDatasetKey) ? primaryDatasetKey[0] : primaryDatasetKey
    }

    return dataGroup.keys().find(key => {
      const node = this.file.get(`${path}/${key}`)
      return node && node.type === "Dataset"
    })
  }

  #resolveYNames (dataGroup, primaryDatasetKey) {
    const result = [primaryDatasetKey]
    const auxiliary = this.#getAttrValue(dataGroup, "auxiliary_signals")

    if (auxiliary) {
      if (Array.isArray(auxiliary)) {
        result.push(...auxiliary)
      } else {
        result.push(auxiliary)
      }
    }

    return [...new Set(result)]
  }

  #resolveAxes (dataGroup, dataset) {
    const axes = this.#getAttrValue(dataGroup, "axes")
    if (Array.isArray(axes)) {
      return axes.map(axis => (axis && String(axis).trim()) ? axis : ".")
    }

    if (typeof axes === "string" && axes.trim() !== "") {
      return [axes]
    }

    return dataset.shape.map((_, index) => `axis_${index}`)
  }

  // ---- Data slicing ----

  #readDatasetVector (name, dataset, axes, bounds = null) {
    if (!dataset) {
      return new Float64Array(0)
    }

    const shape = dataset.shape || []
    if (shape.length === 0) {
      return Float64Array.of(Number(dataset.value))
    }

    const rawSlice = this.#resolveSliceForDataset(name, dataset, axes)
    const selection = this.#convertSliceToDataIndexes(rawSlice, shape)
    const targetDimension = this.#findXAxisDimension(axes, dataset)
    let activeDimensions = 0

    for (let i = 0; i < shape.length; i++) {
      let dimensionLength = 1

      if (i === targetDimension) {
        if (bounds) {
          if (bounds.countLength === 0) {
            return new Float64Array(0)
          }
          const startPos = bounds.startOffset
          const endPos = Math.min(bounds.startOffset + bounds.countLength, shape[targetDimension])
          selection[targetDimension] = [startPos, endPos]
          dimensionLength = endPos - startPos
        } else {
          selection[targetDimension] = [0, shape[targetDimension]]
          dimensionLength = shape[targetDimension]
        }
      } else if (Array.isArray(selection[i])) {
        const axisSlice = selection[i]
        dimensionLength = axisSlice.length === 0 ? shape[i] : axisSlice[1] - axisSlice[0]
      }

      // Count a dimension as active only if it contains more than 1 value
      // (squeeze)
      if (dimensionLength > 1) {
        activeDimensions++
      }
    }

    // h5wasm always returns a flat array, so squeeze is effectively a toggle
    // about how strict we are about dataset dimensions. If true (default) we
    // ignore dimensions of size 1, but false may cause an error to be thrown
    if (!this.options.squeeze) {
      activeDimensions = shape.length
    }

    if (activeDimensions > 1) {
      throw new Error(
        `Dataset "${name}" cannot be parsed into a 1D vector. It has ${activeDimensions} active dimensions. Use "slice" to isolate a single axis.`
      )
    }

    const values = dataset.slice(selection)
    return Float64Array.from(values)
  }

  #resolveSliceForDataset (name, dataset, axes) {
    const shape = dataset.shape || []
    if (Array.isArray(this.options.slice[name])) {
      return this.options.slice[name]
    }

    const slice = new Array(shape.length).fill(":")
    const xAxisIdx = this.#findXAxisDimension(axes, dataset)

    for (let i = 0; i < shape.length; i++) {
      const axisName = axes[i]

      if (axisName && axisName !== "." && this.options.slice[axisName] !== undefined) {
        slice[i] = this.options.slice[axisName]
      } else if (i !== xAxisIdx) {
        slice[i] = 0
      }
    }

    return slice
  }

  #convertSliceToDataIndexes (slice, shape) {
    const selection = []

    for (let i = 0; i < shape.length; i++) {
      if (slice[i] === undefined || slice[i] === null || slice[i] === ":") {
        selection.push([])
        continue
      }

      const value = Number(slice[i])

      if (!Number.isInteger(value)) {
        throw new Error(`Slice index for dimension ${i} must be an integer or ":"`)
      }

      if (value < 0 || value >= shape[i]) {
        throw new Error(`Slice index ${value} is outside dimension ${i} (size ${shape[i]})`)
      }

      selection.push(value)
    }

    return selection
  }

  #findIndexLimitsForDataset (dataset, selection, targetDimension) {
    const totalPoints = dataset.shape[targetDimension]

    let minIdx = 0
    if (this.options.xMin !== -Infinity) {
      minIdx = this.#binarySearch(dataset, selection, targetDimension, this.options.xMin, true)
    }

    let maxIdx = totalPoints - 1
    if (this.options.xMax !== Infinity) {
      maxIdx = this.#binarySearch(dataset, selection, targetDimension, this.options.xMax, false)
    }

    if (minIdx === -1 || maxIdx === -1) {
      return { startOffset: 0, countLength: 0 }
    }

    const firstIndex = Math.min(minIdx, maxIdx)
    const lastIndex = Math.max(minIdx, maxIdx)

    return {
      startOffset: firstIndex,
      countLength: (lastIndex - firstIndex) + 1
    }
  }

  #binarySearch (dataset, selection, targetDimension, targetValue, findFirst) {
    const totalPoints = dataset.shape[targetDimension]

    if (totalPoints === 0) {
      return -1
    }

    const activeSelection = [...selection]

    // Read the first and last items to determine axis direction
    activeSelection[targetDimension] = [0, 1]
    let firstVal = dataset.slice(activeSelection)
    if (firstVal instanceof Float64Array || Array.isArray(firstVal)) {
      firstVal = firstVal[0]
    }

    activeSelection[targetDimension] = [totalPoints - 1, totalPoints]
    let lastVal = dataset.slice(activeSelection)
    if (lastVal instanceof Float64Array || Array.isArray(lastVal)) {
      lastVal = lastVal[0]
    }

    const isDescending = firstVal > lastVal

    let low = 0
    let high = totalPoints - 1
    let result = -1

    while (low <= high) {
      const mid = (low + high) >> 1
      activeSelection[targetDimension] = [mid, mid + 1]

      const sliceData = dataset.slice(activeSelection)
      const val = (sliceData instanceof Float64Array || Array.isArray(sliceData)) ? sliceData[0] : sliceData

      if (findFirst) {
        const match = isDescending ? val <= targetValue : val >= targetValue
        if (match) {
          result = mid
          high = mid - 1
        } else {
          low = mid + 1
        }
      } else {
        const match = isDescending ? val >= targetValue : val <= targetValue
        if (match) {
          result = mid
          low = mid + 1
        } else {
          high = mid - 1
        }
      }
    }
    return result
  }

  #findXAxisDimension (axes, dataset) {
    if (!dataset || !dataset.shape) {
      return 0
    }

    if (!axes || axes.length === 0) {
      return dataset.shape.length - 1
    }

    for (let i = dataset.shape.length - 1; i >= 0; i--) {
      if (axes[i] && axes[i] !== ".") {
        return i
      }
    }

    return dataset.shape.length - 1
  }

  // ---- Metadata ----


  #extractGlobalMetadata () {
    this.metadata = {}

    for (const key of Object.keys(this.file.attrs)) {
      const value = this.#getAttrValue(this.file, key)

      if (value !== null && typeof value !== "object") {
        this.metadata[key] = value
      }
    }

    for (const path of metadataDiscoveryPaths) {
      const node = this.file.get(path)

      if (node) {
        this.#extractMetadataRecursive(node, path.replace(/^\//, ""))
      }
    }
  }

  #extractMetadataRecursive (node, path) {
    if (!node) {
      return
    }

    if (node.type === "Dataset") {
      const shape = node.shape || []

      const isScalar = shape.length === 0 || (shape.length === 1 && shape[0] === 1)
      if (!isScalar) {
        return
      }

      const value = node.value
      if (typeof value === "object") {
        return
      }

      this.metadata[path] = value

      for (const attrName of Object.keys(node.attrs || {})) {
        const attrValue = this.#getAttrValue(node, attrName)

        if (attrValue !== null && typeof attrValue !== "object"
        ) {
          this.metadata[`${path}.${attrName}`] = attrValue
        }
      }

      return
    }

    if (node.type !== "Group") {
      return
    }

    for (const attrName of Object.keys(node.attrs || {})) {
      const attrValue = this.#getAttrValue(node, attrName)

      if (attrValue !== null && typeof attrValue !== "object"
      ) {
        this.metadata[`${path}.${attrName}`] = attrValue
      }
    }

    for (const childName of node.keys()) {
      this.#extractMetadataRecursive(
        node.get(childName),
        `${path}.${childName}`
      )
    }
  }

  // ---- Simple utils ----

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
    if (!node || !node.attrs) {
      return null
    }

    const attr = node.attrs[attrName]
    if (!attr) {
      return null
    }

    const value = attr.value
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return null
      }

      if (value.length === 1) {
        return value[0]
      }
      return value
    }
    return value
  }

  #joinPath (...args) {
    const segments = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (!arg) {
        continue
      }

      let segment = String(arg)
      if (segment.startsWith('/')) {
        segment = segment.slice(1)
      }

      if (segment.endsWith('/')) {
        segment = segment.slice(0, -1)
      }

      if (segment) {
        segments.push(segment)
      }
    }

    return '/' + segments.join('/')
  }
}
