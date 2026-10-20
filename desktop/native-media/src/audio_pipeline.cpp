#include "qsession/audio_pipeline.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace qsession::audio {
namespace {

constexpr double kPcmScale = 32'768.0;
constexpr double kPositiveFullScale =
    static_cast<double>(std::numeric_limits<std::int16_t>::max()) / kPcmScale;

void require_stereo_sample_count(const std::size_t sample_count) {
    if ((sample_count % kContractChannels) != 0U) {
        throw std::invalid_argument("QSession audio must contain complete stereo frames");
    }
}

double normalized(const std::int16_t sample) {
    return static_cast<double>(sample) / kPcmScale;
}

}  // namespace

ConversionResult convert_float32_to_pcm16(
    const std::span<const float> interleaved_stereo,
    const double gain_db) {
    require_stereo_sample_count(interleaved_stereo.size());
    if (!std::isfinite(gain_db)) {
        throw std::invalid_argument("Gain must be finite");
    }

    const double gain = std::pow(10.0, gain_db / 20.0);
    ConversionResult result;
    result.samples.reserve(interleaved_stereo.size());

    for (const float input_sample : interleaved_stereo) {
        if (!std::isfinite(input_sample)) {
            throw std::invalid_argument("Audio samples must be finite");
        }

        const double amplified = static_cast<double>(input_sample) * gain;
        if (std::abs(amplified) >= 1.0) {
            ++result.clipped_samples;
        }

        const double saturated = std::clamp(amplified, -1.0, kPositiveFullScale);
        result.samples.push_back(static_cast<std::int16_t>(std::lround(saturated * kPcmScale)));
    }

    return result;
}

StereoMetrics measure_stereo(
    const std::span<const std::int16_t> interleaved_stereo,
    const double dual_mono_threshold_db) {
    require_stereo_sample_count(interleaved_stereo.size());
    if (!std::isfinite(dual_mono_threshold_db)) {
        throw std::invalid_argument("Dual-mono threshold must be finite");
    }

    StereoMetrics metrics;
    if (interleaved_stereo.empty()) {
        return metrics;
    }

    double total_energy = 0.0;
    double difference_energy = 0.0;
    double left_energy = 0.0;
    double right_energy = 0.0;
    const std::size_t frame_count = interleaved_stereo.size() / kContractChannels;

    for (std::size_t frame = 0; frame < frame_count; ++frame) {
        const double left = normalized(interleaved_stereo[frame * 2U]);
        const double right = normalized(interleaved_stereo[(frame * 2U) + 1U]);
        const double difference = left - right;

        left_energy += left * left;
        right_energy += right * right;
        total_energy += (left * left) + (right * right);
        difference_energy += difference * difference;
        metrics.peak_left = std::max(metrics.peak_left, std::abs(left));
        metrics.peak_right = std::max(metrics.peak_right, std::abs(right));
    }

    const double mean_total_energy = total_energy / static_cast<double>(interleaved_stereo.size());
    if (mean_total_energy < kSilenceEnergyThreshold) {
        return metrics;
    }

    metrics.active = true;
    metrics.rms_left = std::sqrt(left_energy / static_cast<double>(frame_count));
    metrics.rms_right = std::sqrt(right_energy / static_cast<double>(frame_count));

    const double mean_difference_energy = difference_energy / static_cast<double>(frame_count);
    const double difference_ratio = std::max(
        mean_difference_energy / (mean_total_energy * 2.0),
        1.0e-12);
    metrics.difference_db = 10.0 * std::log10(difference_ratio);
    metrics.dual_mono = metrics.difference_db < dual_mono_threshold_db;
    return metrics;
}

}  // namespace qsession::audio
