#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace qsession::audio {

inline constexpr std::uint32_t kContractSampleRate = 48'000;
inline constexpr std::uint16_t kContractChannels = 2;
inline constexpr std::size_t kSamplesPerTenMillisecondFrame = 480;
inline constexpr double kSilenceEnergyThreshold = 1.0e-8;
inline constexpr double kDifferenceFloorDb = -120.0;
inline constexpr double kDefaultDualMonoThresholdDb = -45.0;

struct ConversionResult {
    std::vector<std::int16_t> samples;
    std::size_t clipped_samples{};
};

struct StereoMetrics {
    bool active{};
    bool dual_mono{};
    double difference_db{kDifferenceFloorDb};
    double rms_left{};
    double rms_right{};
    double peak_left{};
    double peak_right{};
};

// Input and output are interleaved left/right stereo. Gain defaults to unity.
// A sample at or beyond full scale is counted as clipping before saturation.
[[nodiscard]] ConversionResult convert_float32_to_pcm16(
    std::span<const float> interleaved_stereo,
    double gain_db = 0.0);

[[nodiscard]] StereoMetrics measure_stereo(
    std::span<const std::int16_t> interleaved_stereo,
    double dual_mono_threshold_db = kDefaultDualMonoThresholdDb);

}  // namespace qsession::audio
