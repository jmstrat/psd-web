import { Messages } from "./messages.js"
import { SharedFileReader } from "./importing/filereader.js"
import {
  allocateRunner,
  runPSD,
  getProfile,
  getSinglePhase
} from "./analysis/psd.js"

onmessage = async ({ data }) => {
  switch (data.type) {
    case Messages.PROCESS: {
      try {
        await SharedFileReader.loadData(
          data.files,
          {
            ...data,
            progressCallback: (p) => postMessage({
              type: Messages.PROGRESS,
              stage: 'read',
              ...p
            })
          }
        )
        postMessage({
          type: Messages.PROGRESS,
          stage: "calculate"
        })
        const { transferList, ...result } = runPSD(data)
        postMessage({
          type: Messages.PROGRESS,
          stage: "finished"
        })
        postMessage({
          type: Messages.RESULT,
          ...result
        }, transferList)
      } catch (err) {
        console.error(err)
        postMessage({
          type: Messages.ERROR,
          message: err?.message ?? err
        })
      }
      break
    }
    case Messages.GET_PHASE_PROFILE: {
      try {
        postMessage({
          type: Messages.PROGRESS,
          stage: "calculate"
        })
        const sharedRunner = allocateRunner()
        const { transferList, maxPhase, ...result } = getProfile(data, sharedRunner)
        postMessage({
          type: Messages.PHASE_PROFILE_RESULT,
          maxPhase,
          ...result
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
          ...result2
        }, transferList2)

        postMessage({
          type: Messages.PROGRESS,
          stage: "finished"
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
          stage: "calculate"
        })
        const { transferList, ...result } = getSinglePhase(data)
        postMessage({
          type: Messages.SINGLE_PHASE_RESULT,
          ...result,
          targetPhase: data.targetPhase
        }, transferList)
        postMessage({
          type: Messages.PROGRESS,
          stage: "finished"
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
