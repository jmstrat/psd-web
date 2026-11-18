#pragma once

extern "C" {

void runDifferential(
  const double* averagedPeriod,
  int spectraPerPeriod,
  int spectrumLength,
  int referenceIndex,
  double* output
);

void runDifferentialForSingleScan(
  const double* averagedPeriod,
  int spectraPerPeriod,
  int spectrumLength,
  int targetScanIndex,
  int referenceIndex,
  double* outputSpectrum
);

void runDifferentialProfile(
  const double* averagedPeriod,
  int spectraPerPeriod,
  int spectrumLength,
  int targetXIndex,
  int referenceIndex,
  double* outputY
);

}
