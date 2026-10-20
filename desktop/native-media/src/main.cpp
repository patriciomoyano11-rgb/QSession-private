#include "qsession/audio_pipeline.h"

#include <array>
#include <iomanip>
#include <iostream>

int main() {
    constexpr std::array<float, 8> kStereoProbe{
        0.25F, -0.125F,
        -0.25F, 0.125F,
        0.50F, -0.25F,
        -0.50F, 0.25F,
    };

    const auto converted = qsession::audio::convert_float32_to_pcm16(kStereoProbe);
    const auto metrics = qsession::audio::measure_stereo(converted.samples);

    std::cout << "QSession native audio core\n"
              << "Contract: " << qsession::audio::kContractSampleRate << " Hz, "
              << qsession::audio::kContractChannels << " channels\n"
              << std::fixed << std::setprecision(2)
              << "Stereo difference: " << metrics.difference_db << " dB\n"
              << "Classification: " << (metrics.dual_mono ? "DUAL MONO" : "STEREO") << '\n'
              << "Clipped samples: " << converted.clipped_samples << '\n';
    return metrics.active && !metrics.dual_mono && converted.clipped_samples == 0U ? 0 : 1;
}
