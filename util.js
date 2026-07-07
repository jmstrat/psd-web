// This class takes objects and flattens them into a single object with the superset
// of keys. Where values differ, the resulting object will have an array will all values
export class Accumulator {
  constructor () {
    this.results = {}
  }

  merge (newMeta) {
    for (const [key, masterVal] of Object.entries(this.results)) {
      const newVal = newMeta[key]

      if (newVal === undefined) {
        if (!Array.isArray(masterVal)) {
          this.results[key] = [masterVal]
        }
        if (!this.results[key].includes(undefined)) {
          this.results[key].push(undefined)
        }
        continue
      }

      if (Array.isArray(masterVal)) {
        if (!masterVal.includes(newVal)) {
          masterVal.push(newVal)
        }
      } else if (masterVal !== newVal) {
        this.results[key] = [masterVal, newVal]
      }
    }

    for (const [key, newVal] of Object.entries(newMeta)) {
      if (this.results[key] === undefined) {
        this.results[key] = newVal
      }
    }
  }

  getResults () {
    return this.results
  }
}

// A wrapped TypedArray that can expand if required
export class ExpandableBuffer {
  constructor (TypedArrayConstructor = Float64Array, initialCapacity = 6000) {
    this.Constructor = TypedArrayConstructor
    this.array = new this.Constructor(initialCapacity)
    this.count = 0
  }

  push (value) {
    if (this.count >= this.array.length) {
      this.#grow()
    }
    this.array[this.count] = value
    this.count++
  }

  reset () {
    this.count = 0
  }

  getValue (immutable = false) {
    if (immutable) {
      return this.array.slice(0, this.count)
    }
    return this.array.subarray(0, this.count)
  }

  #grow () {
    const newCapacity = this.array.length * 2
    const newArray = new this.Constructor(newCapacity)
    newArray.set(this.array)
    this.array = newArray
  }
}

// as addEventListener("click", callback) but with a small debounce to ignore
// double clicks
export function onSingleClick (element, callback, signal, delay = 200) {
  let timer = null

  const handler = (event) => {
    // If the browser registers a double-click, cancel the pending single click
    if (event.detail > 1) {
      clearTimeout(timer)
      return
    }

    const preservedEvent = {
      clientX: event.clientX,
      clientY: event.clientY,
      target: event.target
    }

    timer = setTimeout(() => {
      callback(preservedEvent)
    }, delay)
  }
  element.addEventListener("click", handler, { signal })
}

// Finds the index of a point in an array nearest to the target value
export function nearest (points, target) {
  if (!points || points.length === 0) {
    return -1
  }

  const getX = (idx) => {
    const p = points[idx]
    return p?.x !== undefined ? p.x : p
  }

  let low = 0
  let high = points.length - 1

  // Binary search
  while (low <= high) {
    const mid = (low + high) >> 1
    const midX = getX(mid)

    if (midX === target) {
      return mid
    }

    if (target < midX) {
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  const idxA = Math.max(0, Math.min(points.length - 1, low))
  const idxB = Math.max(0, Math.min(points.length - 1, high))

  const diffA = Math.abs(getX(idxA) - target)
  const diffB = Math.abs(getX(idxB) - target)

  return diffA < diffB ? idxA : idxB
}

/**
 * WARNING: This function mutates objects in place for performance
 * Do not use if target or source will be used after this function call
 */
export function deepMerge (target, source) {
  if (!isObject(target) || !isObject(source)) {
    return source
  }

  for (const key of Object.keys(source)) {
    const targetValue = target[key]
    const sourceValue = source[key]

    if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
      const len = sourceValue.length
      for (let i = 0; i < len; i++) {
        targetValue.push(sourceValue[i])
      }
    } else if (isObject(sourceValue)) {
      if (!(key in target) || !isObject(targetValue)) {
        target[key] = sourceValue
      } else {
        target[key] = deepMerge(targetValue, sourceValue)
      }
    } else {
      target[key] = sourceValue
    }
  }

  return target
}

function isObject (item) {
  return item && typeof item === 'object' && !Array.isArray(item)
}
