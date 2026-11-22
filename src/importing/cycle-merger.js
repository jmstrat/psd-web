// This class is responsible for taking data from multiple cycles and averaging them
// into a single cycle. It does not assume that the cycle period is a multiple of the
// acquisition period, if it isn't then data are re-binned.
// Optionally, adjacent datapoints within the cycle can be merged (mergeCount > 1),
// Note that acqTime is relative to the start of the experiment, the first datapoint
// should have acqTime = 0
export class CycleMerger {
  // This is essentially the inverse of getAveragedPeriod, but
  // rather than an instance method, it is static so that it can
  // be used on processing results as well
  static extractDataset (flatData, spectrumLength, index) {
    const offset = index * spectrumLength

    return new Float64Array(
      flatData.buffer,
      flatData.byteOffset + (offset * Float64Array.BYTES_PER_ELEMENT),
      spectrumLength
    )
  }

  constructor (spectraPerCycle, spectrumLength, cyclePeriodSeconds, mergeCount=1) {
    if (!Number.isInteger(mergeCount) || mergeCount < 1) {
      throw new RangeError('mergeCount must be a positive integer')
    }

    this.spectraPerCycle = spectraPerCycle
    this.spectrumLength = spectrumLength
    this.cyclePeriodSeconds = cyclePeriodSeconds
    this.mergeCount = Math.min(mergeCount, spectraPerCycle)

    // Number of datasets in the output
    this.outputSpectraPerCycle = Math.ceil(spectraPerCycle / this.mergeCount)

    this.sumPeriod = new Float64Array(spectraPerCycle * spectrumLength)
    this.weightSum = new Float64Array(spectraPerCycle)
  }

  addFrame (acqTime, y) {
    const phase = (acqTime % this.cyclePeriodSeconds) / this.cyclePeriodSeconds
    const binF = phase * this.spectraPerCycle
    let b0 = Math.floor(binF)
    let b1 = b0 + 1

    // Wrap around to first bin
    if (b1 >= this.spectraPerCycle) {
      b1 = 0
    }

    const w1 = binF - b0
    const w0 = 1 - w1

    const offset0 = b0 * this.spectrumLength
    const offset1 = b1 * this.spectrumLength

    for (let j = 0; j < this.spectrumLength; j++) {
      const v = y[j]
      this.sumPeriod[offset0 + j] += v * w0
      this.sumPeriod[offset1 + j] += v * w1
    }

    this.weightSum[b0] += w0
    this.weightSum[b1] += w1
  }

  getAveragedPeriod () {
    const len = this.spectrumLength
    const out = new Float64Array(this.outputSpectraPerCycle * len)

    // Merge adjacent spectra
    for (let m = 0; m < this.outputSpectraPerCycle; m++) {
      const start = m * this.mergeCount
      const end = Math.min(start + this.mergeCount, this.spectraPerCycle)
      const outOffset = m * len

      // Total weight across all bins being merged
      let w = 0
      for (let b = start; b < end; b++) {
        w += this.weightSum[b]
      }

      if (!w) {
        continue
      }

      // Sum the weighted data
      for (let b = start; b < end; b++) {
        const offset = b * len
        for (let j = 0; j < len; j++) {
          out[outOffset + j] += this.sumPeriod[offset + j]
        }
      }

      for (let j = 0; j < len; j++) {
        out[outOffset + j] /= w
      }
    }

    return out
  }
}
