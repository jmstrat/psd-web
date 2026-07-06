
# Phase-Sensitive Detection Web App

## Overview
This interactive web application functions as a browser-based phase sensitive detection calculator specifically designed for time-resolved spectroscopy. It isolates weak, time-dependent signals buried under experimental background noise or unchanging background signals.

[Live Application](https://jmstrat.github.io/psd-web/)

## ⚠️ Disclaimer

> **Important:** This project is currently at an early stage of development.

The processing has not been heavily tested. Do not rely solely on this tool without independently verifying the results.


## Key Features
*   **Zero Install:** Runs directly within any modern browser, no installation necessary
*  **Private:** Processes all data locally, ensuring your data never leaves your computer.
*   **Visualizations:** View plots of phase-resolved data, profiles and in-phase data.


## Supported Applications
*   **Pair Distribution Function Analysis:** Takes `.gr` files directly from PDFGetX3
*   **Any Plain Text Data:** Takes 2 column `.xy` files
*   **Possibly more to come...**

## How It Works
1.  **Upload:** Upload your raw time-resolved data files, one file per time point.
2.  **Configure:** Define the time intervals and resolution of the output.
3.  **Interact:** Click on the phase resolved data plot to isolate a single point, view its phase evolution and in phase data.
4.  **Export:** Download the processed data for further processing.

## Development

The javascript side of this application currently does not have a build process. It depends on chart.js which is downloaded at runtime from a CDN. The PSD calculation is written in C++, which requires compiling to WebAssembly.

### Requirements

Install Emscripten:
https://emscripten.org/docs/getting_started/downloads.html

### Build

```bash
cd wasm
./build.sh
```

### Serve

Use any local web server.

For example `python -m http.server`
