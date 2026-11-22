import { Messages, ProgressStage } from "./messages.js"
import { SharedFileReader } from "./importing/filereader.js"

import Runner from "./analysis/wasm-runner.js"
import {
  runPSD,
  getProfile,
  getSinglePhase,
  getAllInPhase
} from "./analysis/psd.js"

import {
  runDifferential,
  getDifferentialProfile,
  getDifferentialSinglePhase,
  getDifferentialInPhase
} from "./analysis/differential.js"

const analysisModes = {
  psd: {
    run: runPSD,
    inPhaseProfile: getAllInPhase,
    profile: getProfile,
    singlePhase: getSinglePhase
  },
  differential: {
    run: runDifferential,
    inPhaseProfile: getDifferentialInPhase,
    profile: getDifferentialProfile,
    singlePhase: getDifferentialSinglePhase
  }
}

let sharedRunner = null

function allocateRunner () {
  if (sharedRunner) {
    sharedRunner.free()
  }

  const { averagedPeriod, timeValues } = SharedFileReader.getData()

  sharedRunner = new Runner()
  .allocate({
    averagedPeriod,
    timeValues
  })
}

function getMode (mode) {
  const fns = analysisModes[mode]

  if (!fns) {
    throw new Error(`Unknown processing mode ${mode}`)
  }
  return fns
}

onmessage = async ({ data }) => {
  switch (data.type) {
    case Messages.IMPORT_AND_RUN_PSD: {
      try {
        await SharedFileReader.loadData(
          data.files,
          data.averagingOptions,
          data.parserOptions,
          (p) => postMessage({
            type: Messages.PROGRESS,
            stage: ProgressStage.READING,
            ...p
          })
        )
        postMessage({
          type: Messages.PROGRESS,
          stage: ProgressStage.CALCULATING
        })

        allocateRunner()
        const mode = getMode(data.processingOptions.mode)

        const { transferList, ...result } = mode.run(data.processingOptions, sharedRunner)
        const { dataType, metadata } = SharedFileReader

        postMessage({
          type: Messages.PSD_RESULT,
          mode: data.processingOptions.mode,
          ...result,
          dataType,
          metadata
        }, transferList)

        const { transferList: transferList2, ...result2 } = mode.inPhaseProfile({
          ...data.processingOptions,
          resolution: 1
        }, sharedRunner)


        postMessage({
          type: Messages.IN_PHASE_PROFILE_RESULT,
          mode: data.processingOptions.mode,
          ...result2,
          dataType
        }, transferList2)

        postMessage({
          type: Messages.PROGRESS,
          stage: ProgressStage.FINISHED
        })
      } catch (err) {
        console.error(err)
        postMessage({
          type: Messages.ERROR,
          message: err?.message ?? err
        })
      }
      break
    }
    case Messages.GET_AVERAGED_PERIOD: {
      postMessage({
        type: Messages.PROGRESS,
        stage: ProgressStage.CALCULATING
      })

      const datasetCount = SharedFileReader.datasetCount
      const datasets = []
      const timeValues = SharedFileReader.timeAxis

      // Note: We need to clone x as otherwise if we use cached data
      // it will be invalid once it has transferred
      const xBufferToTransfer = SharedFileReader.xAxis.slice().buffer
      const transferList = [xBufferToTransfer]

      for (let i = 0; i < datasetCount; i++) {
        const y = SharedFileReader.getDataset(i).slice()
        transferList.push(y.buffer)
        datasets.push({
          label: `${timeValues[i]} s`,
          data: y
        })
      }
      const dataType = SharedFileReader.dataType

      postMessage({
        type: Messages.AVERAGED_PERIOD_RESULT,
        xAxisData: new Float64Array(xBufferToTransfer),
        datasets,
        dataType
      }, transferList)

      postMessage({
        type: Messages.PROGRESS,
        stage: ProgressStage.FINISHED
      })
      break
    }
    case Messages.GET_PHASE_PROFILE: {
      try {
        postMessage({
          type: Messages.PROGRESS,
          stage: ProgressStage.CALCULATING
        })

        const dataType = SharedFileReader.dataType

        if (!sharedRunner) {
          allocateRunner()
        }

        const mode = getMode(data.mode)

        const { transferList, maxPhase, ...result } = mode.profile(data, sharedRunner)
        postMessage({
          type: Messages.PHASE_PROFILE_RESULT,
          mode: data.mode,
          maxPhase,
          ...result,
          dataType
        }, transferList)

        const args = {
          waveType: data.waveType,
          harmonic: data.harmonic,
          targetPhase: maxPhase,

          differentialResolution: data.differentialResolution,
          referenceIndex: data.referenceIndex
        }
        const { transferList: transferList2, ...result2 } = mode.singlePhase(args, sharedRunner)

        postMessage({
          type: Messages.SINGLE_PHASE_RESULT,
          mode: data.mode,
          targetPhase: maxPhase,
          ...result2,
          dataType
        }, transferList2)

        postMessage({
          type: Messages.PROGRESS,
          stage: ProgressStage.FINISHED
        })
      } catch (err) {
        console.error(err)
        postMessage({
          type: Messages.ERROR,
          message: err?.message ?? err
        })
      }
      break
    }
    case Messages.GET_SINGLE_PHASE: {
      try {
        postMessage({
          type: Messages.PROGRESS,
          stage: ProgressStage.CALCULATING
        })

        if (!sharedRunner) {
          allocateRunner()
        }

        const dataType = SharedFileReader.dataType
        const mode = getMode(data.mode)

        const { transferList, ...result } = mode.singlePhase(data, sharedRunner)
        postMessage({
          type: Messages.SINGLE_PHASE_RESULT,
          mode: data.mode,
          ...result,
          targetPhase: data.targetPhase,
          dataType
        }, transferList)
        postMessage({
          type: Messages.PROGRESS,
          stage: ProgressStage.FINISHED
        })
      } catch (err) {
        console.error(err)
        postMessage({
          type: Messages.ERROR,
          message: err?.message ?? err
        })
      }
      break
    }
  }
}

// Tell the main thread that we have loaded and are ready to process data
postMessage({ type: Messages.READY })
