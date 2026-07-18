import { Messages, ProgressStage } from "./messages.js"
import { SharedFileReader } from "./importing/filereader.js"
import {
  allocateRunner,
  runPSD,
  getProfile,
  getSinglePhase
} from "./analysis/psd.js"

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

        const { transferList, ...result } = runPSD(data.processingOptions)

        const { dataType, metadata } = SharedFileReader
        postMessage({
          type: Messages.PSD_RESULT,
          ...result,
          dataType,
          metadata
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

        const sharedRunner = allocateRunner()
        const { transferList, maxPhase, ...result } = getProfile(data, sharedRunner)
        postMessage({
          type: Messages.PHASE_PROFILE_RESULT,
          maxPhase,
          ...result,
          dataType
        }, transferList)

        const args = {
          waveType: data.waveType,
          harmonic: data.harmonic,
          targetPhase: maxPhase
        }
        const { transferList: transferList2, ...result2 } = getSinglePhase(args, sharedRunner)
        sharedRunner.free()

        postMessage({
          type: Messages.SINGLE_PHASE_RESULT,
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

        const dataType = SharedFileReader.dataType

        const { transferList, ...result } = getSinglePhase(data)
        postMessage({
          type: Messages.SINGLE_PHASE_RESULT,
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
