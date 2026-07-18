import { BaseParser } from "../BaseParser.js"

import h5wasm from "h5wasm"

const metadataDiscoveryPaths = [
  "/entry/instrument",
  "/entry/sample",
  "/entry/user"
]

// TODO we should allow overriding the x axis
// dataPath: Explicitly targets a specific HDF5 group path for data extraction (default tries to automatically find the main data)
// primaryDataset: Explicitly defines the name of the main dataset containing the intensity data (default uses the group's default signal attribute)
// xMin / xMax: Limits the X range that is read
// slice: Configures multidimensional cuts by dimension or by axis name (see below)

/*
Slice Options:

Slice by Axis Name:
  slice: { posX: 0, posY: { start: 0, end: 5, step: 2 }, posZ: [1, 3, 7] }

Slice by Dimension:
  slice: [0, ":", { start: 0, end: 5 }, [1, 3, 7]]

Valid Formats:
  - ":"                           : The whole dimension
  - number                        : An single index
  - Array<number>                 : A list of indices
  - Object {start?, end?, step?}    : A range

Fallback:
  Any dimension not matched defaults to 0 if it is not the x axis dimension
*/
export class NexusParser extends BaseParser {
  validateOptions (options = {}) {
    if (options.slice && typeof options.slice !== "object") {
      throw new Error("slice must be an object")
    }

    if (options.slice !== undefined) {
      const { slice } = options

      if (Array.isArray(slice)) {
        if (slice.length === 0) {
          throw new Error("slice array cannot be empty")
        }

        for (const part of slice) {
          NexusParser.#validateSliceValue(part, "array element")
        }
      } else if (slice && typeof slice === "object") {
        for (const [axis, value] of Object.entries(slice)) {
          if (typeof axis !== "string" || axis.trim() === "") {
            throw new Error("slice axis names must be non-empty strings")
          }
          NexusParser.#validateSliceValue(value, `axis "${axis}"`)
        }
      }
    }

    return {
      dataPath: options.dataPath || null,
      primaryDataset: options.primaryDataset || null,
      slice: options.slice || {},
      xMin: options.xMin !== undefined ? options.xMin : -Infinity,
      xMax: options.xMax !== undefined ? options.xMax : Infinity,
      ...super.validateOptions(options)
    }
  }

  static #validateSliceValue (value, contextName) {
    // Simple values
    if (value === ":" || Number.isInteger(value)) {
      return
    }

    // Ranges
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.start !== undefined && !Number.isInteger(value.start)) {
        throw new Error(`slice range 'start' for ${contextName} must be an integer`)
      }
      if (value.end !== undefined && !Number.isInteger(value.end)) {
        throw new Error(`slice range 'end' for ${contextName} must be an integer`)
      }
      if (value.step !== undefined && (!Number.isInteger(value.step) || value.step <= 0)) {
        throw new Error(`slice range 'step' for ${contextName} must be a positive integer`)
      }
      return
    }

    // Array of indices
    if (Array.isArray(value)) {
      for (const idx of value) {
        if (!Number.isInteger(idx)) {
          throw new Error(`slice index list for ${contextName} must contain only integers`)
        }
      }
      return
    }

    throw new Error(`slice value for ${contextName} must be an integer, range object, array, or ":"`)
  }

  async getDatasetCount (fileObj) {
    await this.#openVirtualFile(fileObj)

    try {
      const { group, path } = this.#resolveDataGroup()
      if (!group) {
        return 0
      }

      const primaryDatasetKey = this.#resolvePrimaryDatasetKey(group, path)
      if (!primaryDatasetKey) {
        return 0
      }

      const primaryDataset = this.file.get(`${path}/${primaryDatasetKey}`)
      if (!primaryDataset) {
        return 0
      }

      const axes = this.#resolveAxes(group, primaryDataset)
      const rawSlice = this.#resolveSliceForDataset(primaryDataset, axes)
      const shape = primaryDataset.shape || []

      const coordinatePairs = this.#parseSliceToDimensionCoordinates(rawSlice, shape)
      const selectionsGrid = this.#buildSelectionGrid(coordinatePairs)
      return selectionsGrid.length
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

    const primaryDatasetKey = this.#resolvePrimaryDatasetKey(group, path)
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

    const shape = xDataset.shape || []

    if (shape.length !== 1) {
      throw new Error(`X-axis dataset "${xName}" must be a 1D vector, but has a shape length of ${shape.length}`)
    }

    const baseSelection = Array.from({ length: shape.length }, () => [])
    const targetDimension = this.#findXAxisDimension(axes, primaryDataset)
    const bounds = this.#findIndexLimitsForDataset(xDataset, baseSelection, targetDimension)
    data.bounds = bounds

    return this.#readDatasetVector(xDataset, axes, baseSelection, bounds)
  }

  #readYDatasets (data) {
    const { primaryDatasetKey, primaryDataset, axes, bounds } = data
    const yOutputs = []

    const rawSlice = this.#resolveSliceForDataset(primaryDataset, axes)
    const shape = primaryDataset.shape || []

    const coordinatePairs = this.#parseSliceToDimensionCoordinates(rawSlice, shape)
    const selectionsGrid = this.#buildSelectionGrid(coordinatePairs)

    for (let i = 0; i < selectionsGrid.length; i++) {
      const selection = selectionsGrid[i]
      const yVector = this.#readDatasetVector(primaryDataset, axes, selection, bounds)

      yOutputs.push(yVector)
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
      x: this.#getLabel(xDataset, xName, "x"),
      y: this.#getLabel(primaryDataset, primaryDatasetKey, "intensity")
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

  #resolvePrimaryDatasetKey (dataGroup, path) {
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

  #readDatasetVector (dataset, axes, selection, bounds = null) {
    if (!dataset) {
      return new Float64Array(0)
    }

    const shape = dataset.shape || []
    if (shape.length === 0) {
      return Float64Array.of(Number(dataset.value))
    }

    const xDimension = this.#findXAxisDimension(axes, dataset)

    // Clone to avoid mutation
    selection = selection.map(coord => [...coord])

    if (bounds) {
      if (bounds.countLength === 0) {
        return new Float64Array(0)
      }
      const startPos = bounds.startOffset
      const endPos = Math.min(bounds.startOffset + bounds.countLength, shape[xDimension])
      selection[xDimension] = [startPos, endPos]
    } else {
      selection[xDimension] = [0, shape[xDimension]]
    }

    const values = dataset.slice(selection)
    return Float64Array.from(values)
  }

  #resolveSliceForDataset (dataset, axes) {
    const shape = dataset.shape || []
    if (Array.isArray(this.options.slice)) {
      return this.options.slice
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

  #parseSliceToDimensionCoordinates (slice, shape) {
    const coordinatesByDimension = []

    for (let i = 0; i < shape.length; i++) {
      const val = slice[i]

      // Use the whole of this axis
      if (val === undefined || val === null || val === ":") {
        coordinatesByDimension.push([ [] ])
        continue
      }

      // Range {start, end, step } all optional
      if (typeof val === "object" && !Array.isArray(val)) {
        const start = val.start ?? 0
        const end = val.end ?? shape[i]
        const step = val.step ?? 1

        const dimensionRanges = []
        for (let idx = start; idx < end; idx += step) {
          if (idx >= 0 && idx < shape[i]) {
            dimensionRanges.push([idx, idx + 1])
          }
        }
        coordinatesByDimension.push(dimensionRanges)
        continue
      }

      // Array of indices
      if (Array.isArray(val)) {
        const dimensionIndices = val.map(idx => {
          const value = Number(idx)
          if (value < 0 || value >= shape[i]) {
            throw new Error(`Slice index ${value} is outside dimension ${i} (size ${shape[i]})`)
          }
          return [value, value + 1]
        })
        coordinatesByDimension.push(dimensionIndices)
        continue
      }

      // Single integer
      const value = Number(val)
      if (!Number.isInteger(value)) {
        throw new Error(`Slice index for dimension ${i} must be an integer, range object, array, or ":"`)
      }
      if (value < 0 || value >= shape[i]) {
        throw new Error(`Slice index ${value} is outside dimension ${i} (size ${shape[i]})`)
      }
      coordinatesByDimension.push([ [value, value + 1] ])
    }

    return coordinatesByDimension
  }

  #buildSelectionGrid (coordinatesByDimension) {
    const generate = (axisIndex) => {
      if (axisIndex === coordinatesByDimension.length) {
        return [[]]
      }

      const subGrid = generate(axisIndex + 1)
      const results = []

      for (const currentCoordinate of coordinatesByDimension[axisIndex]) {
        for (const subSelection of subGrid) {
          results.push([currentCoordinate, ...subSelection])
        }
      }

      return results
    }

    return generate(0)
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
      try {
        const node = this.file.get(path)

        if (node) {
          this.#extractMetadataRecursive(node, path.replace(/^\//, ""))
        }
      } catch (err) {
        console.warn(`Failed to extract metadata for path ${path}`)
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
      return { label: absoluteFallback, unit: null }
    }

    const units = this.#getAttrValue(dataset, "units") || null
    const longName = this.#getAttrValue(dataset, "long_name")

    if (longName) {
      return { label: String(longName), unit: units }
    }

    return {
      label: fallbackName || absoluteFallback,
      unit: units
    }
  }

  #utf8FromAsciiBytes (str) {
    const bytes = new Uint8Array(str.length)

    // Windows-1252 characters from 0x80 to 0x9F in order
    const WIN1252_EXTENSION_CHARS = "€ ‚ƒ„…†‡ˆ‰Š‹Œ Ž  ‘’“”•–—˜™š›œ žŸ"

    const MAX_LATIN1_CHAR_CODE = 255
    const WIN1252_BYTE_OFFSET = 0x80
    const ASCII_FALLBACK_QUESTION_MARK = 0x3F

    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)

      if (code <= MAX_LATIN1_CHAR_CODE) {
        // Standard Latin-1/ASCII maps 1:1 to raw bytes
        bytes[i] = code
      } else {
        const index = WIN1252_EXTENSION_CHARS.indexOf(str[i])

        // Reconstruct the true byte value using the offset, fallback to '?' if unmappable
        bytes[i] = index !== -1
          ? WIN1252_BYTE_OFFSET + index
          : ASCII_FALLBACK_QUESTION_MARK
      }
    }

    return new TextDecoder('utf-8').decode(bytes)
  }

  #getAttrValue (node, attrName) {
    if (!node || !node.attrs) {
      return null
    }

    const attr = node.attrs[attrName]
    if (!attr) {
      return null
    }

    let value = attr.value

    // cset: 0 is ASCII
    // dtype: A or Ax denotes ASCII / Fortran string format
    // Unfortunately, it is common for tools to write UTF-8 encoded text into
    // HDF5 files without updating the metadata character set from its default (ASCII).
    // We therefore assume that any non-ASCII characters found in these containers
    // are actually UTF-8 bytes that were incorrectly decoded as individual characters.
    // This creates a small risk of corruption for files that strictly follow the
    // ASCII/Latin-1 standard AND use high-range printing characters, but this is
    // vastly less likely than encountering unflagged UTF-8. If the metadata explicitly
    // sets cset to UTF-8 (cset: 1), we trust it and do not process it further.
    const isASCII = attr.metadata?.cset === 0 || attr.dtype?.startsWith('A')

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return null
      }

      if (isASCII) {
        value = value.map(item => (typeof item === 'string' ? this.#utf8FromAsciiBytes(item) : item))
      }

      return value.length === 1 ? value[0] : value
    }

    if (isASCII && typeof value === 'string') {
      return this.#utf8FromAsciiBytes(value)
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
