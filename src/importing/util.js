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
