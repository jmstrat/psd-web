import { createCSVStream } from "./csv.js"
import { Zip, ZipPassThrough } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.3/+esm'

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

function getPSDStream (psdData) {
  const xlab = psdData.dataType?.xlab ?? "x_value"
  const psdHeaders = [xlab, ...psdData.datasets.map(d => d.label)]
  const psdYArrays = psdData.datasets.map(d => d.data)
  return createCSVStream(psdHeaders, psdData.xAxisData, psdYArrays)
}

function getArchiveFileStreams ({ psdData, profileData, singlePhaseData, parameters }) {
  if (!psdData) {
    alert("No processed datasets found to export.")
    return
  }

  const metaStream = getArchiveMetadataStream(parameters)

  const filesToArchive = [
    { name: "meta.txt", stream: metaStream },
    { name: "psd.csv", stream: getPSDStream(psdData) }
  ]

  if (profileData) {
    filesToArchive.push({
      name: "phase_profile.csv",
      stream: createCSVStream(
        ["Theta", "intensity"],
        profileData.phaseAngles,
        [profileData.intensities]
      )
    })
  }

  if (singlePhaseData) {
    const xlab = singlePhaseData.dataType?.xlab ?? "x_value"
    const ylab = singlePhaseData.dataType?.ylab ?? "intensity"
    filesToArchive.push({
      name: "in_phase.csv",
      stream: createCSVStream(
        [xlab, ylab],
        singlePhaseData.xAxisData,
        [singlePhaseData.yAxisData]
      )
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

export async function downloadAnalysisArchive (data) {
  const filesToArchive = getArchiveFileStreams(data)
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
