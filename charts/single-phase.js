import { createBaseChart } from "./base-chart.js"
import { destroyChart } from './util.js'

const SinglePhaseChartCtx = document.getElementById("chartSinglePhase").getContext("2d")
let SinglePhaseChart = null

export function renderSinglePhase ({ xAxisData, yAxisData, targetPhase, dataType }) {
  const dataset = {
    label: '',
    borderColor: "#000",
    backgroundColor: "#000",
    pointRadius: 0,
    pointHoverRadius: 4,
    borderWidth: 1.5,
    fill: false,
    tension: 0,
    data: yAxisData
  }

  const titleText = `θ = ${targetPhase}°`

  if (!SinglePhaseChart) {
    SinglePhaseChart = createBaseChart(
      SinglePhaseChartCtx,
      {
        data: { datasets: [dataset] },
        options: {
          plugins: {
            tooltip: {
              enabled: true
            },
            title: {
              display: true,
              text: titleText,
              font: { size: 14, weight: "bold" }
            },
          },
          scales: {
            x: {
              labels: xAxisData,
              title: { display: true, text: dataType?.xlab }
            },
            y: {
              title: { display: true, text: dataType?.ylab }
            }
          }
        }
      }
    )
  } else {
    SinglePhaseChart.data.datasets = [dataset]
    SinglePhaseChart.options.plugins.title.text = titleText
    SinglePhaseChart.options.scales.x.labels = xAxisData
    SinglePhaseChart.options.scales.x.title.text = dataType?.xlab
    SinglePhaseChart.options.scales.y.title.text = dataType?.ylab
    SinglePhaseChart.update("none")
  }
}

export function destroySinglePhase () {
  destroyChart(
    SinglePhaseChart,
    SinglePhaseChartCtx,
    "Click on a data point on the main PSD chart to show the data that is in phase at that point"
  )
  SinglePhaseChart = null
}
