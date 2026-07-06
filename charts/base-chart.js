import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  SubTitle,
  Tooltip,
  Legend,
  Decimation
} from "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/+esm"
import zoomPlugin from 'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.2.0/+esm'

import { box, verticalHoverLine } from './util.js'

import { onSingleClick, deepMerge } from "../util.js"

Chart.register(LineController, LineElement, PointElement, LinearScale, Title, SubTitle, Tooltip, Legend, Decimation, zoomPlugin)

export function createBaseChart (ctx, userConfig = {}, onclick) {
  const defaults = {
    type: 'line',
    data: {
      datasets: []
    },
    options: {
      animation: false,
      spanGaps: true,
      normalized: true,
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      transitions: {
        zoom: {
          animation: { duration: 0 }
        }
      },
      plugins: {
        legend: { display: false },
        zoom: {
          zoom: {
            drag: { enabled: true },
            mode: 'x',
            scaleMode: 'x'
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          grid: {
            display: true,
            drawOnChartArea: false,
            drawTicks: true,
            color: '#ccc',
            tickLength: 6
          },
          border: { display: true, color: '#000', width: 1 },
          ticks: { display: true },
          afterTickToLabelConversion(scaleInstance) {
            const ticks = scaleInstance.ticks
            if (!ticks || ticks.length < 2) {
              return
            }
            const newTicks = []
            for (let i = 0; i < ticks.length - 1; i++) {
              newTicks.push(ticks[i])
              const midValue = (ticks[i].value + ticks[i + 1].value) / 2
              newTicks.push({ value: midValue, label: "" })
            }
            newTicks.push(ticks[ticks.length - 1])
            scaleInstance.ticks = newTicks
          }
        },
        y: {
          grid: { display: false },
          border: { display: true, color: '#000', width: 1 },
          ticks: { display: false }
        }
      }
    },
    plugins: [ box, verticalHoverLine ]
  }

  // Note this will mutate defaults & userConfig
  const config = deepMerge(defaults, userConfig)
  const chart = new Chart(ctx, config)

  chart.canvas.addEventListener('dblclick', () => {
    if (typeof chart.resetZoom === 'function') {
      chart.resetZoom('none')
    }
  })

  if (onclick) {
    onSingleClick(chart.canvas, (event) => {
        const activeElements = chart.getElementsAtEventForMode(event, 'index', { intersect: false }, false)

        if (!activeElements || activeElements.length === 0) {
          return
        }

        const nearestIndex = activeElements[0].index
        let snappedX = null

        if (chart.data.labels && chart.data.labels[nearestIndex] !== undefined) {
          const labelData = chart.data.labels[nearestIndex]
          snappedX = labelData?.x !== undefined ? labelData.x : labelData
        } else {
          const pixelX = activeElements[0].element.x
          snappedX = chart.scales.x.getValueForPixel(pixelX)
        }

        onclick(snappedX, nearestIndex)
    })
  }

  return chart
}
