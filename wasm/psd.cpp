#include "psd.h"
#include <cmath>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace {

inline double wrapAngle(double value) {
  double wrapped = std::fmod(value, 2.0 * M_PI);
  if (wrapped < 0.0) {
    wrapped += 2.0 * M_PI;
  }
  return wrapped;
}

inline double squareWave(double value) {
  double wrapped = wrapAngle(value);
  return (wrapped >= M_PI) ? -1.0 : 1.0;
}

inline double triangleWave(double value) {
  double wrapped = wrapAngle(value);
  if (wrapped < M_PI) {
    return 1.0 - (2.0 * wrapped / M_PI);
  } else {
    return -3.0 + (2.0 * wrapped / M_PI);
  }
}

// Logic shared between runPSD and runPhaseProfile
struct SimulationParameters {
  int phaseCount;
  double angularFrequency;
  double normalizationFactor;
};

inline SimulationParameters calculateSimulationParameters(
  int spectraPerPeriod,
  double phaseResolutionDegrees,
  const double* timeValues
) {
  SimulationParameters params;

  params.phaseCount = static_cast<int>(std::round(360.0 / phaseResolutionDegrees));
  params.normalizationFactor = 2.0 / spectraPerPeriod;

  // A full cycle duration is the difference in start times between the first and last measurement
  // plus the time taken for the last measurement
  const double tStart = timeValues[0];
  const double tLast = timeValues[spectraPerPeriod - 1];
  const double timeStep = (spectraPerPeriod > 1) ? (tLast - tStart) / (spectraPerPeriod - 1) : 0.0;
  const double periodLength = (tLast - tStart) + timeStep;

  // omega = 2*pi*f
  params.angularFrequency = (periodLength > 0.0) ? (2.0 * M_PI) / periodLength : 0.0;

  return params;
}

inline std::vector<double> calculateMeans(
  const double* averagedPeriod,
  int spectraPerPeriod,
  int spectrumLength
) {
  std::vector<double> means(spectrumLength, 0.0);

  // Sum amplitudes across all time steps for each individual bin
  for (int timeIndex = 0; timeIndex < spectraPerPeriod; ++timeIndex) {
    const int timeOffset = timeIndex * spectrumLength;
    for (int xIndex = 0; xIndex < spectrumLength; ++xIndex) {
      means[xIndex] += averagedPeriod[timeOffset + xIndex];
    }
  }

  // Divide by total sample points
  const double scale = 1.0 / spectraPerPeriod;
  for (double& value : means) {
    value *= scale;
  }

  return means;
}

inline double calculateMean(
  const double* averagedPeriod,
  int spectraPerPeriod,
  int spectrumLength,
  int targetXIndex
) {
  double mean = 0.0;

  for (int timeIndex = 0; timeIndex < spectraPerPeriod; ++timeIndex) {
    mean += averagedPeriod[timeIndex * spectrumLength + targetXIndex];
  }

  return mean / spectraPerPeriod;
}

inline double generateReferenceSample(WaveType waveType, double theta) {
  switch (waveType) {
    case WaveType_Square:
      return squareWave(theta);
    case WaveType_Triangle:
      return triangleWave(theta);
    case WaveType_Sine:
    default:
      return std::sin(theta);
  }
}

} // namespace

extern "C" {

// ---------------------------------------------------------------------------
// PHASE-SENSITIVE DETECTION CALCULATION
// ---------------------------------------------------------------------------
// We loop through different phase shifts to find exactly when the pattern changes.
// First we compute and subtract the temporal mean (DC baseline) to avoid false
// correlations from unmodulated background signals.
// Then we multiply the signal by a reference waveform and integrate over one period
// (a single-frequency Fourier projection in the case of a sine wave), which
// preferentially extracts components oscillating at the selected modulation frequency.
//
// Signal components that are phase-coherent with the reference accumulate
// constructively, while components at other frequencies are
// progressively attenuated over the integration interval.
// Static backgrounds are removed by the DC subtraction, while
// uncorrelated noise and out-of-phase components are reduced.

void runPSD(
  const double* averagedPeriod,
  const double* timeValues,
  int spectraPerPeriod,
  int spectrumLength,
  double phaseResolutionDegrees,
  WaveType waveType,
  int harmonic,
  double* output
) {
  // Extract all shared experimental time and frequency dimensions
  const auto params = calculateSimulationParameters(spectraPerPeriod, phaseResolutionDegrees, timeValues);

  // Clear the target memory space
  std::fill_n(output, params.phaseCount * spectrumLength, 0.0);

  const auto means = calculateMeans(averagedPeriod, spectraPerPeriod, spectrumLength);

  for (int phaseIndex = 0; phaseIndex < params.phaseCount; phaseIndex++) {
    // (radians)
    const double phaseShift = phaseIndex * phaseResolutionDegrees * M_PI / 180.0;
    const int phaseOffset = phaseIndex * spectrumLength;

    for (int timeIndex = 0; timeIndex < spectraPerPeriod; timeIndex++) {
      const double t = timeValues[timeIndex];
      const int timeOffset = timeIndex * spectrumLength;

      const double theta = harmonic * params.angularFrequency * t + phaseShift;

      const double reference = generateReferenceSample(waveType, theta) * params.normalizationFactor;

      // Remove the DC baseline and multiply by the reference signal
      for (int xIndex = 0; xIndex < spectrumLength; xIndex++) {
        const double signal = averagedPeriod[timeOffset + xIndex] - means[xIndex];
        output[phaseOffset + xIndex] += signal * reference;
      }
    }
  }
}

void runPSDForSinglePhase(
  const double* averagedPeriod,
  const double* timeValues,
  int spectraPerPeriod,
  int spectrumLength,
  double targetPhaseDegrees,
  WaveType waveType,
  int harmonic,
  double* output
) {
  // Extract all shared experimental time and frequency dimensions
  // n.b. phaseResolutionDegrees is not used so we set a dummy value here
  const auto params = calculateSimulationParameters(spectraPerPeriod, 360.0, timeValues);

  // Clear the target memory space
  std::fill_n(output, spectrumLength, 0.0);

  const auto means = calculateMeans(averagedPeriod, spectraPerPeriod, spectrumLength);

  // (radians)
  const double phaseShift = targetPhaseDegrees * M_PI / 180.0;

  for (int timeIndex = 0; timeIndex < spectraPerPeriod; timeIndex++) {
    const double t = timeValues[timeIndex];
    const int timeOffset = timeIndex * spectrumLength;

    const double theta = harmonic * params.angularFrequency * t + phaseShift;

    const double reference = generateReferenceSample(waveType, theta) * params.normalizationFactor;

    // Remove the DC baseline and multiply by the reference signal
    for (int xIndex = 0; xIndex < spectrumLength; xIndex++) {
      const double signal = averagedPeriod[timeOffset + xIndex] - means[xIndex];
      output[xIndex] += signal * reference;
    }
  }
}


// This is a simplified version of runPSD that only runs the calculation for a single x value
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
) {
  // Extract all shared experimental time and frequency dimensions
  const auto params = calculateSimulationParameters(spectraPerPeriod, phaseResolutionDegrees, timeValues);

  const double mean = calculateMean(averagedPeriod, spectraPerPeriod, spectrumLength, targetXIndex);

  for (int phaseIndex = 0; phaseIndex < params.phaseCount; phaseIndex++) {
    // (radians)
    const double phaseShift = phaseIndex * phaseResolutionDegrees * M_PI / 180.0;

    double accumulation = 0.0;

    for (int timeIndex = 0; timeIndex < spectraPerPeriod; timeIndex++) {
      const double t = timeValues[timeIndex];

      const double theta = harmonic * params.angularFrequency * t + phaseShift;

      const double reference = generateReferenceSample(waveType, theta) * params.normalizationFactor;

      // Remove the DC baseline and multiply by the reference signal
      const double signal = averagedPeriod[timeIndex * spectrumLength + targetXIndex] - mean;
      accumulation += signal * reference;
    }

    outputY[phaseIndex] = accumulation;
  }
}

} // extern "C"
