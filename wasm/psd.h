#pragma once

// Plain c enum to work within c style exports
typedef enum : int {
  WaveType_Sine = 0,
  WaveType_Square = 1,
  WaveType_Triangle = 2
} WaveType;

extern "C" {

void runPSD(
  const double* averagedPeriod,
  const double* timeValues,
  int spectraPerPeriod,
  int spectrumLength,
  double phaseResolutionDegrees,
  WaveType waveType,
  int harmonic,
  double* output
);

void runPSDForSinglePhase(
  const double* averagedPeriod,
  const double* timeValues,
  int spectraPerPeriod,
  int spectrumLength,
  double targetPhaseDegrees,
  WaveType waveType,
  int harmonic,
  double* output
);

void runPhaseProfile(
  const double* averagedPeriod,
  const double* timeValues,
  int spectraPerPeriod,
  int spectrumLength,
  double phaseResolutionDegrees,
  WaveType waveType,
  int harmonic,
  int targetXIndex,
  double* outputY
);

}
