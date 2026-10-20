#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace qsession::media {

class LiveKitPublisher final {
public:
    LiveKitPublisher();
    ~LiveKitPublisher();

    LiveKitPublisher(const LiveKitPublisher&) = delete;
    LiveKitPublisher& operator=(const LiveKitPublisher&) = delete;

    int start(const std::string& url, const std::string& token, bool publish_audio = true);
    void stop();
    void enqueue(std::vector<std::int16_t> interleaved_stereo);
    int enable_video(int width, int height);
    void disable_video();
    void capture_video_frame(int width, int height, std::vector<std::uint8_t> bgra);

    [[nodiscard]] bool connected() const noexcept;
    [[nodiscard]] bool video_published() const noexcept;
    [[nodiscard]] std::uint64_t dropped_frames() const noexcept;
    [[nodiscard]] std::uint64_t dropped_video_frames() const noexcept;
    [[nodiscard]] std::wstring last_error() const;

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

LiveKitPublisher& publisher();

}  // namespace qsession::media
