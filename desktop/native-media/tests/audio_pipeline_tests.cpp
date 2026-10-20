#include "qsession/audio_pipeline.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <exception>
#include <iostream>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

void require(const bool condition, const std::string_view message) {
    if (!condition) {
        throw std::runtime_error(std::string(message));
    }
}

template <std::size_t Size>
void require_samples(
    const std::span<const std::int16_t> actual,
    const std::array<std::int16_t, Size>& expected,
    const std::string_view message) {
    require(actual.size() == expected.size(), message);
    for (std::size_t index = 0; index < expected.size(); ++index) {
        require(actual[index] == expected[index], message);
    }
}

void test_silence() {
    constexpr std::array<float, 8> input{};
    constexpr std::array<std::int16_t, 8> expected{};
    const auto conversion = qsession::audio::convert_float32_to_pcm16(input);
    const auto metrics = qsession::audio::measure_stereo(conversion.samples);

    require_samples(conversion.samples, expected, "Silence PCM changed");
    require(conversion.clipped_samples == 0U, "Silence was classified as clipped");
    require(!metrics.active, "Silence was classified as active");
    require(!metrics.dual_mono, "Silence was classified as dual mono");
    require(metrics.difference_db == qsession::audio::kDifferenceFloorDb, "Silence floor changed");
}

void test_unity_gain_stereo() {
    constexpr std::array<float, 8> input{
        0.25F, -0.125F,
        -0.25F, 0.125F,
        0.50F, -0.25F,
        -0.50F, 0.25F,
    };
    constexpr std::array<std::int16_t, 8> expected{
        8192, -4096,
        -8192, 4096,
        16384, -8192,
        -16384, 8192,
    };
    const auto conversion = qsession::audio::convert_float32_to_pcm16(input);
    const auto metrics = qsession::audio::measure_stereo(conversion.samples);

    require_samples(conversion.samples, expected, "Unity-gain stereo PCM changed");
    require(conversion.clipped_samples == 0U, "Unity-gain stereo clipped");
    require(metrics.active, "Stereo vector was classified as silent");
    require(!metrics.dual_mono, "Stereo vector was classified as dual mono");
    require(metrics.peak_left == 0.5, "Left peak changed");
    require(metrics.peak_right == 0.25, "Right peak changed");
}

void test_dual_mono() {
    constexpr std::array<float, 8> input{
        0.125F, 0.125F,
        -0.25F, -0.25F,
        0.375F, 0.375F,
        -0.50F, -0.50F,
    };
    constexpr std::array<std::int16_t, 8> expected{
        4096, 4096,
        -8192, -8192,
        12288, 12288,
        -16384, -16384,
    };
    const auto conversion = qsession::audio::convert_float32_to_pcm16(input);
    const auto metrics = qsession::audio::measure_stereo(conversion.samples);

    require_samples(conversion.samples, expected, "Dual-mono PCM changed");
    require(metrics.active, "Dual mono was classified as silent");
    require(metrics.dual_mono, "Equal channels were not classified as dual mono");
    require(std::abs(metrics.difference_db - qsession::audio::kDifferenceFloorDb) < 1.0e-9,
            "Dual-mono floor changed");
}

void test_hard_clipping() {
    constexpr std::array<float, 4> input{1.25F, -1.25F, 1.0F, -1.0F};
    constexpr std::array<std::int16_t, 4> expected{32767, -32768, 32767, -32768};
    const auto conversion = qsession::audio::convert_float32_to_pcm16(input);
    const auto metrics = qsession::audio::measure_stereo(conversion.samples);

    require_samples(conversion.samples, expected, "Clipping saturation changed");
    require(conversion.clipped_samples == 4U, "Clipped sample count changed");
    require(metrics.active, "Clipped vector was classified as silent");
    require(!metrics.dual_mono, "Opposite-polarity clipping was classified as dual mono");
}

void test_invalid_input_is_rejected() {
    constexpr std::array<float, 1> incomplete_frame{0.25F};
    bool rejected = false;
    try {
        static_cast<void>(qsession::audio::convert_float32_to_pcm16(incomplete_frame));
    } catch (const std::invalid_argument&) {
        rejected = true;
    }
    require(rejected, "Incomplete stereo frame was accepted");
}

}  // namespace

int main() {
    try {
        test_silence();
        test_unity_gain_stereo();
        test_dual_mono();
        test_hard_clipping();
        test_invalid_input_is_rejected();
        std::cout << "QSession native audio core tests passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "QSession native audio core test failed: " << error.what() << '\n';
        return 1;
    }
}
