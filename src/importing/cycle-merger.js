// This class is responsible for taking data from multiple cycles and averaging them
// into a single cycle. It does not assume that the cycle period is a multiple of the
// acquisition period, if it isn't then data are re-binned.
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

  constructor (spectraPerCycle, spectrumLength, cyclePeriodSeconds) {
    this.spectraPerCycle = spectraPerCycle
    this.spectrumLength = spectrumLength
    this.cyclePeriodSeconds = cyclePeriodSeconds

    this.averagedPeriod = new Float64Array(spectraPerCycle * spectrumLength)
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
      this.averagedPeriod[offset0 + j] += v * w0
      this.averagedPeriod[offset1 + j] += v * w1
    }

    this.weightSum[b0] += w0
    this.weightSum[b1] += w1
  }

  getAveragedPeriod () {
    for (let b = 0; b < this.spectraPerCycle; b++) {
      const w = this.weightSum[b]
      if (!w) {
        continue
      }

      const offset = b * this.spectrumLength

      for (let j = 0; j < this.spectrumLength; j++) {
        this.averagedPeriod[offset + j] /= w
      }
    }

    return this.averagedPeriod
  }
}
