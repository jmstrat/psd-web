import { createCSVStream } from "./csv.js"
import { Zip, ZipPassThrough } from 'fflate'
import { axisLabel } from '@/charts/util.js'

const defaultOptions = {
  multicolumn: 'combined',
  separator: ','
}

function formatMetadataValue (value, indent = '') {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    let result = ''
    for (const [subKey, subValue] of Object.entries(value)) {
      result += `\n${indent}  - ${subKey}: ${formatMetadataValue(subValue, indent + '  ')}`
    }
    return result
  }

  if (Array.isArray(value)) {
    return value.join(', ')
  }

  return value
}

function formatMetadataSection (title, options) {
  const underline = '-'.repeat(title.length)
  let section = `${title}\n${underline}\n`

  for (const [key, value] of Object.entries(options)) {
    section += `- ${key}: ${formatMetadataValue(value)}\n`
  }
  return section
}

function getArchiveMetadataStream({
  averagingOptions,
  parserOptions,
  processingOptions
}) {
  const encoder = new TextEncoder()

  let metaText = `PSD Analysis\n============\nAnalysis Performed: ${new Date().toISOString()}`

  metaText += '\n\n'
  metaText += formatMetadataSection("Importing", parserOptions)
  metaText += '\n\n'
  metaText += formatMetadataSection("Averaging", averagingOptions)
  metaText += '\n\n'
  metaText += formatMetadataSection("Processing", processingOptions)

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(metaText))
      controller.close()
    }
  })
}

function getMultiColumnStream (data, separator) {
  const xlab = axisLabel(data.dataType.x)
  const headings = [xlab, ...data.datasets.map(d => d.label)]
  const yValueArrays = data.datasets.map(d => d.data)
  return createCSVStream(headings, data.xAxisData, yValueArrays, separator)
}

function getMultiColumnSplitStreams (data, separator) {
  const xlab = axisLabel(data.dataType.x)
  const ylab = axisLabel(data.dataType.y)
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
    averagingOptions,
    parserOptions,
    processingOptions,
    canvases
  },
  options
) {
  if (!psdData) {
    alert("No processed datasets found to export.")
    return
  }

  options = {
    ...defaultOptions,
    ...options
  }

  const ext = options.separator === ',' ? 'csv' : 'dat'

  const metaStream = getArchiveMetadataStream({
    averagingOptions,
    parserOptions,
    processingOptions
  })

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
    const xlab = axisLabel(singlePhaseData.dataType.x)
    const ylab = axisLabel(singlePhaseData.dataType.y)
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
