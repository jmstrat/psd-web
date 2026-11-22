#!/bin/bash

mkdir ../wasm-build/

# INITIAL_MEMORY=64MB
em++ psd.cpp differential.cpp -O3 -flto -msimd128 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=worker \
  -s INITIAL_MEMORY=67108864 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s GROWABLE_ARRAYBUFFERS=2 \
  -s FILESYSTEM=0 \
  -s DISABLE_EXCEPTION_CATCHING=1 \
  -s AUTO_JS_LIBRARIES=0 \
  -s AUTO_NATIVE_LIBRARIES=0 \
  -s INCOMING_MODULE_JS_API=[] \
  -s EXPORTED_FUNCTIONS='["_runPSD", "_runPSDForSinglePhase", "_runPhaseProfile", "_runPSDMaxPhase", "_runDifferential", "_runDifferentialForSingleScan", "_runDifferentialProfile", "_runDifferentialMaxScan", "_malloc", "_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF64"]' \
  -o ../wasm-build/psd.js
