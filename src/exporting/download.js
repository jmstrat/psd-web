import { createCSVStream } from "./csv.js"
import { Zip, ZipPassThrough } from 'fflate'

const defaultOptions = {
  multicolumn: 'combined',
  separator: ','
}

function getArchiveMetadataStream (parameters) {
  const encoder = new TextEncoder()

  let metaText = `PSD Analysis Parameters\n================\nAnalysis Performed: ${new Date().toISOString()}\n\n`
  for (const [key, value] of Object.entries(parameters)) {
    metaText += `- ${key}: ${value}\n`
  }

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(metaText))
      controller.close()
    }
  })
}

function getMultiColumnStream (data, separator) {
  const xlab = data.dataType?.xlab ?? "x_value"
  const headings = [xlab, ...data.datasets.map(d => d.label)]
  const yValueArrays = data.datasets.map(d => d.data)
  return createCSVStream(headings, data.xAxisData, yValueArrays, separator)
}

function getMultiColumnSplitStreams (data, separator) {
  const xlab = data.dataType?.xlab ?? "x_value"
  const ylab = data.dataType?.ylab ?? "y_value"
  const headings = [xlab, ylab]
  const streams = {}
  for (const d of data.datasets) {
    streams[d.label] = createCSVStream(headings, data.xAxisData, [d.data], separator)
  }
  return streams
}

function getCanvasWithBackground (sourceCanvas, colour) {
  const { width, height } = sourceCanvas
  const offscreenCanvas = document.createElement('canvas')
  offscreenCanvas.width = width
  offscreenCanvas.height = height
  const ctx = offscreenCanvas.getContext('2d')
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(sourceCanvas, 0, 0)
  return offscreenCanvas
}

function getCanvasStream (canvas, type='image/png', background='#fff') {
  return new ReadableStream({
    async start (controller) {
      try {
        const blob = await new Promise((resolve, reject) => {
          getCanvasWithBackground(canvas, background).toBlob((b) => {
            if (b) {
              resolve(b)
            } else {
              reject(new Error("Canvas blob generation failed"))
            }
          }, type)
        })

        const reader = blob.stream().getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          controller.enqueue(value)
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    }
  })
}


function getArchiveFileStreams (
  {
    averagePeriod,
    psdData,
    profileData,
    singlePhaseData,
    parameters,
    canvases
  },
  options
) {
  if (!psdData) {
    alert("No processed datasets found to export.")
    return
  }

  console.log(options)

  options = {
    ...defaultOptions,
    ...options
  }

  const ext = options.separator === ',' ? 'csv' : 'dat'

  const metaStream = getArchiveMetadataStream(parameters)

  const filesToArchive = [
    { name: "meta.txt", stream: metaStream }
  ]

  if (options.multicolumn === 'combined') {
    filesToArchive.push(
      { name: `averaged_period.${ext}`, stream: getMultiColumnStream(averagePeriod, options.separator) },
      { name: `psd.${ext}`, stream: getMultiColumnStream(psdData, options.separator) }
    )
  } else {
    const avgPeriodStreams = getMultiColumnSplitStreams(averagePeriod, options.separator)
    for (const [name, stream] of Object.entries(avgPeriodStreams)) {
      filesToArchive.push(
        { name: `averaged_period/${name}.${ext}`, stream }
      )
    }

    const psdStreams = getMultiColumnSplitStreams(psdData, options.separator)
    for (const [name, stream] of Object.entries(psdStreams)) {
      filesToArchive.push(
        { name: `psd/${name}.${ext}`, stream }
      )
    }
  }

  if (profileData) {
    filesToArchive.push({
      name: `phase_profile.${ext}`,
      stream: createCSVStream(
        ["Theta", "intensity"],
        profileData.phaseAngles,
        [profileData.intensities],
        options.separator
      )
    })
  }

  if (singlePhaseData) {
    const xlab = singlePhaseData.dataType?.xlab ?? "x_value"
    const ylab = singlePhaseData.dataType?.ylab ?? "intensity"
    filesToArchive.push({
      name: `selected_phase.${ext}`,
      stream: createCSVStream(
        [xlab, ylab],
        singlePhaseData.xAxisData,
        [singlePhaseData.yAxisData],
        options.separator
      )
    })
  }

  for (const [ filename, canvas ] of Object.entries(canvases)) {
    filesToArchive.push({
      name: `${filename}.png`,
      stream: getCanvasStream(canvas)
    })
  }

  return filesToArchive
}


async function pipeStreamToZipFile (fileStream, zipStream) {
  const reader = fileStream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    zipStream.push(value)
  }
  zipStream.push(new Uint8Array(0), true)
}

export async function downloadAnalysisArchive (data, options) {
  const filesToArchive = getArchiveFileStreams(data, options)
  if (!filesToArchive) {
    return
  }

  const zipChunks = []

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      throw err
    }
    zipChunks.push(chunk)

    if (final) {
      const downloadBlob = new Blob(zipChunks, { type: 'application/zip' })
      const url = URL.createObjectURL(downloadBlob)

      const timestamp = new Date().toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .substring(0, 15)

      const downloadAnchor = document.createElement("a")
      downloadAnchor.href = url
      downloadAnchor.download = `psd_export_${timestamp}.zip`
      document.body.appendChild(downloadAnchor)
      downloadAnchor.click()

      document.body.removeChild(downloadAnchor)
      URL.revokeObjectURL(url)
    }
  })

  for (const file of filesToArchive) {
    const zipFileStream = new ZipPassThrough(file.name)
    zip.add(zipFileStream)
    await pipeStreamToZipFile(file.stream, zipFileStream)
  }

  zip.end()
}
