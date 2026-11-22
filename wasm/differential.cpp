#include "differential.h"

#include <cmath>

#include <algorithm>

namespace {

inline bool isValidIndex(int index, int count) {
  return index >= 0 && index < count;
}

} // namespace

extern "C" {

void runDifferential(
  const double* averagedPeriod,
  int spectraPerPeriod,
  int spectrumLength,
  int referenceIndex,
  double* output
) {
  const long long total = static_cast<long long>(spectraPerPeriod) * spectrumLength;
  std::fill_n(output, total > 0 ? total : 0, 0.0);

  if (spectraPerPeriod <= 0 || spectrumLength <= 0 || !isValidIndex(referenceIndex, spectraPerPeriod)) {
    return;
  }

  const double* reference = averagedPeriod + static_cast<long long>(referenceIndex) * spectrumLength;

  for (int timeIndex = 0; timeIndex < spectraPerPeriod; timeIndex++) {
    const long long timeOffset = static_cast<long long>(timeIndex) * spectrumLength;

    for (int xIndex = 0; xIndex < spectrumLength; xIndex++) {
      output[timeOffset + xIndex] = averagedPeriod[timeOffset + xIndex] - reference[xIndex];
    }
  }
}

void runDifferentialForSingleScan(
  const double* averagedPeriod,
  int spectraPerPeriod,
  int spectrumLength,
  int targetScanIndex,
  int referenceIndex,
  double* outputSpectrum
) {
  std::fill_n(outputSpectrum, spectrumLength > 0 ? spectrumLength : 0, 0.0);

  if (spectrumLength <= 0 ||
      !isValidIndex(targetScanIndex, spectraPerPeriod) ||
      !isValidIndex(referenceIndex, spectraPerPeriod)) {
    return;
  }

  const double* target = averagedPeriod + static_cast<long long>(targetScanIndex) * spectrumLength;
  const double* reference = averagedPeriod + static_cast<long long>(referenceIndex) * spectrumLength;

  for (int xIndex = 0; xIndex < spectrumLength; xIndex++) {
    outputSpectrum[xIndex] = target[xIndex] - reference[xIndex];
  }
}

// Differential signal at a single x value across all scans
void runDifferentialProfile(
  const double* averagedPeriod,
  int spectraPerPeriod,
  int spectrumLength,
  int targetXIndex,
  int referenceIndex,
  double* outputY
) {
  std::fill_n(outputY, spectraPerPeriod > 0 ? spectraPerPeriod : 0, 0.0);

  if (spectraPerPeriod <= 0 ||
      !isValidIndex(targetXIndex, spectrumLength) ||
      !isValidIndex(referenceIndex, spectraPerPeriod)) {
    return;
  }

  const double referenceValue =
    averagedPeriod[static_cast<long long>(referenceIndex) * spectrumLength + targetXIndex];

  for (int timeIndex = 0; timeIndex < spectraPerPeriod; timeIndex++) {
    outputY[timeIndex] =
      averagedPeriod[static_cast<long long>(timeIndex) * spectrumLength + targetXIndex] - referenceValue;
  }
}


// For every x point, finds the scan at which the differential signal is at
// its maximum.
//
// If useAbsoluteValue is non-zero the largest magnitude is used.
// outputMaxValues is optional (may be nullptr)
void runDifferentialMaxScan(
  const double* averagedPeriod,
  int spectraPerPeriod,
  int spectrumLength,
  int referenceIndex,
  int useAbsoluteValue,
  double* outputScanIndices,
  double* outputMaxValues
) {
  if (spectrumLength <= 0) {
    return;
  }

  std::fill_n(outputScanIndices, spectrumLength, 0.0);
  if (outputMaxValues != nullptr) {
    std::fill_n(outputMaxValues, spectrumLength, 0.0);
  }

  if (spectraPerPeriod <= 0 || !isValidIndex(referenceIndex, spectraPerPeriod)) {
    return;
  }

  const double* reference = averagedPeriod + static_cast<long long>(referenceIndex) * spectrumLength;

  for (int xIndex = 0; xIndex < spectrumLength; xIndex++) {
    int bestIndex = 0;
    double bestValue = averagedPeriod[xIndex] - reference[xIndex];
    double bestScore = useAbsoluteValue ? std::fabs(bestValue) : bestValue;

    for (int timeIndex = 1; timeIndex < spectraPerPeriod; timeIndex++) {
      const double value =
        averagedPeriod[static_cast<long long>(timeIndex) * spectrumLength + xIndex] - reference[xIndex];
      const double score = useAbsoluteValue ? std::fabs(value) : value;

      if (score > bestScore) {
        bestScore = score;
        bestValue = value;
        bestIndex = timeIndex;
      }
    }

    outputScanIndices[xIndex] = static_cast<double>(bestIndex);
    if (outputMaxValues != nullptr) {
      outputMaxValues[xIndex] = bestValue;
    }
  }
}

} // extern "C"
