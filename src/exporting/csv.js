export function createCSVStream (headers, xAxisData, yAxisDataArrays, separator=',', chunkSize = 2000) {
  let rowIndex = 0
  const rowCount = xAxisData.length
  const datasetCount = yAxisDataArrays.length
  const encoder = new TextEncoder()

  return new ReadableStream({
    start (controller) {
      controller.enqueue(encoder.encode(headers.join(separator) + "\n"))
    },

    async pull (controller) {
      let chunkString = ""
      const limit = Math.min(rowIndex + chunkSize, rowCount)

      for (; rowIndex < limit; rowIndex++) {
        let row = `${xAxisData[rowIndex]}`
        for (let j = 0; j < datasetCount; j++) {
          row += `${separator}${yAxisDataArrays[j][rowIndex]}`
        }
        chunkString += row + "\n"
      }

      if (chunkString.length > 0) {
        controller.enqueue(encoder.encode(chunkString))
      }

      if (rowIndex >= rowCount) {
        controller.close()
      }
    }
  })
}
