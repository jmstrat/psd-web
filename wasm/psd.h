#pragma once

extern "C" {

void runPSD(
  const double* averagedPeriod,
  const double* timeValues,
  int spectraPerPeriod,
  int spectrumLength,
  double phaseResolutionDegrees,
  int harmonic,
  double* output
);

void runPSDForSinglePhase(
  const double* averagedPeriod,
  const double* timeValues,
  int spectraPerPeriod,
  int spectrumLength,
  double targetPhaseDegrees,
  int harmonic,
  double* output
);

void runPhaseProfile(
  const double* averagedPeriod,
  const double* timeValues,
  int spectraPerPeriod,
  int spectrumLength,
  double phaseResolutionDegrees,
  int harmonic,
  int targetXIndex,
  double* outputY
);

int getPSDOutputSize(
  int spectrumLength,
  double phaseResolutionDegrees
);

}
