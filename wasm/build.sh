#!/bin/bash

mkdir ../wasm-build/

# INITIAL_MEMORY=64MB
emcc psd.cpp -O3 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=worker \
  -s INITIAL_MEMORY=67108864 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_runPSD", "_runPSDForSinglePhase", "_runPhaseProfile", "_malloc", "_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF64"]' \
  -o ../wasm-build/psd.js
