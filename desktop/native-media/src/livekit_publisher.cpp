#include "qsession/livekit_publisher.h"

#include <Windows.h>
#include <livekit/livekit.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace qsession::media {
namespace {

constexpr int kSampleRate = 48'000;
constexpr int kChannels = 2;
constexpr int kSamplesPerChannel = 480;
constexpr std::size_t kSamplesPerFrame = kSamplesPerChannel * kChannels;
constexpr std::size_t kMaximumQueuedFrames = 24;

std::wstring widen(const std::string& value) {
    if (value.empty()) {
        return {};
    }
    const int size = MultiByteToWideChar(
        CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (size <= 0) {
        return L"Error multimedia de QSession";
    }
    std::wstring result(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(
        CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), size);
    return result;
}

}  // namespace

class LiveKitPublisher::Impl final {
public:
    ~Impl() { stop(); }

    int start(const std::string& url, const std::string& token, const bool publish_audio) {
        stop();
        clear_error();
        dropped_frames_.store(0U);

        try {
            livekit::initialize(livekit::LogLevel::Warn);
            initialized_ = true;

            auto next_room = std::make_unique<livekit::Room>();
            livekit::RoomOptions options;
            options.auto_subscribe = false;
            options.dynacast = false;
            if (!next_room->connect(url, token, options)) {
                set_error(L"QSession Media rechazó la conexión de publicación.");
                livekit::shutdown();
                initialized_ = false;
                return -1;
            }

            std::shared_ptr<livekit::AudioSource> next_source;
            std::shared_ptr<livekit::LocalAudioTrack> next_track;
            if (publish_audio) {
                next_source = std::make_shared<livekit::AudioSource>(kSampleRate, kChannels, 0);
                next_track = livekit::LocalAudioTrack::createLocalAudioTrack(
                    "qsession-hd-audio", next_source);
                livekit::TrackPublishOptions publish_options;
                publish_options.source = livekit::TrackSource::SOURCE_SCREENSHARE_AUDIO;
                publish_options.dtx = false;
                publish_options.simulcast = false;
                publish_options.red = false;

                auto local_participant = next_room->localParticipant().lock();
                if (!local_participant) {
                    throw std::runtime_error("local participant unavailable");
                }
                local_participant->publishTrack(next_track, publish_options);
            }

            {
                std::scoped_lock lock(state_mutex_);
                room_ = std::move(next_room);
                source_ = std::move(next_source);
                track_ = std::move(next_track);
            }
            running_.store(publish_audio);
            connected_.store(true);
            if (publish_audio) {
                worker_ = std::thread([this] { publish_loop(); });
            }
            return 0;
        } catch (const std::exception& error) {
            set_error(L"No fue posible publicar el audio: " + widen(error.what()));
            cleanup_media();
            return -1;
        } catch (...) {
            set_error(L"No fue posible publicar el audio por un error multimedia inesperado.");
            cleanup_media();
            return -1;
        }
    }

    void stop() {
        disable_video();
        running_.store(false);
        queue_ready_.notify_all();
        if (worker_.joinable()) {
            worker_.join();
        }
        cleanup_media();
        {
            std::scoped_lock lock(queue_mutex_);
            queue_.clear();
        }
    }

    void enqueue(std::vector<std::int16_t> samples) {
        if (!connected_.load() || samples.size() != kSamplesPerFrame) {
            return;
        }
        {
            std::scoped_lock lock(queue_mutex_);
            if (queue_.size() >= kMaximumQueuedFrames) {
                queue_.pop_front();
                dropped_frames_.fetch_add(1U);
            }
            queue_.push_back(std::move(samples));
        }
        queue_ready_.notify_one();
    }

    int enable_video(const int width, const int height) {
        if (width <= 0 || height <= 0) {
            set_error(L"La cámara no informó una resolución válida.");
            return -1;
        }
        disable_video();
        try {
            auto next_source = std::make_shared<livekit::VideoSource>(width, height);
            auto next_track = livekit::LocalVideoTrack::createLocalVideoTrack(
                "qsession-dj-camera", next_source);
            livekit::TrackPublishOptions publish_options;
            publish_options.source = livekit::TrackSource::SOURCE_CAMERA;
            publish_options.simulcast = false;
            publish_options.video_encoding = livekit::VideoEncodingOptions{
                2'500'000U,
                30.0,
            };
            publish_options.degradation_preference = livekit::DegradationPreference::MaintainFramerate;

            {
                std::scoped_lock lock(state_mutex_);
                if (!room_ || !connected_.load()) {
                    set_error(L"La sala multimedia debe estar conectada antes de activar el video.");
                    return -1;
                }
                auto participant = room_->localParticipant().lock();
                if (!participant) {
                    set_error(L"No fue posible acceder al publicador de video de la sala.");
                    return -1;
                }
                participant->publishTrack(next_track, publish_options);
                video_source_ = std::move(next_source);
                video_track_ = std::move(next_track);
                video_width_ = width;
                video_height_ = height;
            }
            dropped_video_frames_.store(0U);
            video_published_.store(true);
            return 0;
        } catch (const std::exception& error) {
            set_error(L"No fue posible publicar el video: " + widen(error.what()));
            video_published_.store(false);
            return -1;
        } catch (...) {
            set_error(L"No fue posible publicar el video por un error multimedia inesperado.");
            video_published_.store(false);
            return -1;
        }
    }

    void disable_video() {
        video_published_.store(false);
        std::shared_ptr<livekit::LocalVideoTrack> track;
        std::shared_ptr<livekit::LocalParticipant> participant;
        {
            std::scoped_lock lock(state_mutex_);
            track = std::move(video_track_);
            video_source_.reset();
            video_width_ = 0;
            video_height_ = 0;
            if (room_) {
                participant = room_->localParticipant().lock();
            }
        }
        if (participant && track) {
            try {
                if (const auto publication = track->publication()) {
                    participant->unpublishTrack(publication->sid());
                }
            } catch (...) {
            }
        }
    }

    void capture_video_frame(
        const int width,
        const int height,
        std::vector<std::uint8_t> bgra) {
        if (!video_published_.load()) {
            return;
        }
        try {
            std::scoped_lock lock(state_mutex_);
            if (!video_source_ || width != video_width_ || height != video_height_) {
                dropped_video_frames_.fetch_add(1U);
                return;
            }
            const std::size_t expected = static_cast<std::size_t>(width) *
                                         static_cast<std::size_t>(height) * 4U;
            if (bgra.size() != expected) {
                dropped_video_frames_.fetch_add(1U);
                return;
            }
            const auto timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
                std::chrono::steady_clock::now().time_since_epoch()).count();
            const livekit::VideoFrame frame(
                width,
                height,
                livekit::VideoBufferType::BGRA,
                std::move(bgra));
            video_source_->captureFrame(frame, timestamp);
        } catch (const std::exception& error) {
            dropped_video_frames_.fetch_add(1U);
            set_error(L"La publicación de video perdió un cuadro: " + widen(error.what()));
        } catch (...) {
            dropped_video_frames_.fetch_add(1U);
        }
    }

    [[nodiscard]] bool connected() const noexcept { return connected_.load(); }
    [[nodiscard]] bool video_published() const noexcept { return video_published_.load(); }
    [[nodiscard]] std::uint64_t dropped_frames() const noexcept { return dropped_frames_.load(); }
    [[nodiscard]] std::uint64_t dropped_video_frames() const noexcept {
        return dropped_video_frames_.load();
    }

    [[nodiscard]] std::wstring last_error() const {
        std::scoped_lock lock(error_mutex_);
        return last_error_;
    }

private:
    void publish_loop() {
        while (running_.load()) {
            std::vector<std::int16_t> samples;
            {
                std::unique_lock lock(queue_mutex_);
                queue_ready_.wait(lock, [this] { return !running_.load() || !queue_.empty(); });
                if (!running_.load() && queue_.empty()) {
                    return;
                }
                samples = std::move(queue_.front());
                queue_.pop_front();
            }

            try {
                std::shared_ptr<livekit::AudioSource> source;
                {
                    std::scoped_lock lock(state_mutex_);
                    source = source_;
                }
                if (!source) {
                    return;
                }
                const livekit::AudioFrame frame(
                    std::move(samples), kSampleRate, kChannels, kSamplesPerChannel);
                source->captureFrame(frame, 100);
            } catch (const std::exception& error) {
                set_error(L"La publicación de audio se interrumpió: " + widen(error.what()));
                connected_.store(false);
                running_.store(false);
                return;
            } catch (...) {
                set_error(L"La publicación de audio se interrumpió inesperadamente.");
                connected_.store(false);
                running_.store(false);
                return;
            }
        }
    }

    void cleanup_media() {
        connected_.store(false);
        std::unique_ptr<livekit::Room> room;
        std::shared_ptr<livekit::LocalAudioTrack> track;
        std::shared_ptr<livekit::LocalVideoTrack> video_track;
        {
            std::scoped_lock lock(state_mutex_);
            room = std::move(room_);
            track = std::move(track_);
            video_track = std::move(video_track_);
            source_.reset();
            video_source_.reset();
        }
        if (room) {
            try {
                if (auto participant = room->localParticipant().lock()) {
                    if (track) {
                        if (const auto publication = track->publication()) {
                            participant->unpublishTrack(publication->sid());
                        }
                    }
                    if (video_track) {
                        if (const auto publication = video_track->publication()) {
                            participant->unpublishTrack(publication->sid());
                        }
                    }
                }
            } catch (...) {
            }
        }
        room.reset();
        if (initialized_) {
            livekit::shutdown();
            initialized_ = false;
        }
    }

    void set_error(std::wstring message) {
        std::scoped_lock lock(error_mutex_);
        last_error_ = std::move(message);
    }

    void clear_error() {
        std::scoped_lock lock(error_mutex_);
        last_error_.clear();
    }

    std::atomic<bool> running_{false};
    std::atomic<bool> connected_{false};
    std::atomic<bool> video_published_{false};
    std::atomic<std::uint64_t> dropped_frames_{0U};
    std::atomic<std::uint64_t> dropped_video_frames_{0U};
    bool initialized_{false};
    std::mutex state_mutex_;
    std::unique_ptr<livekit::Room> room_;
    std::shared_ptr<livekit::AudioSource> source_;
    std::shared_ptr<livekit::LocalAudioTrack> track_;
    std::shared_ptr<livekit::VideoSource> video_source_;
    std::shared_ptr<livekit::LocalVideoTrack> video_track_;
    int video_width_{0};
    int video_height_{0};
    std::mutex queue_mutex_;
    std::condition_variable queue_ready_;
    std::deque<std::vector<std::int16_t>> queue_;
    std::thread worker_;
    mutable std::mutex error_mutex_;
    std::wstring last_error_;
};

LiveKitPublisher::LiveKitPublisher() : impl_(std::make_unique<Impl>()) {}
LiveKitPublisher::~LiveKitPublisher() = default;
int LiveKitPublisher::start(const std::string& url, const std::string& token, const bool publish_audio) {
    return impl_->start(url, token, publish_audio);
}
void LiveKitPublisher::stop() { impl_->stop(); }
void LiveKitPublisher::enqueue(std::vector<std::int16_t> samples) { impl_->enqueue(std::move(samples)); }
int LiveKitPublisher::enable_video(const int width, const int height) { return impl_->enable_video(width, height); }
void LiveKitPublisher::disable_video() { impl_->disable_video(); }
void LiveKitPublisher::capture_video_frame(
    const int width,
    const int height,
    std::vector<std::uint8_t> bgra) {
    impl_->capture_video_frame(width, height, std::move(bgra));
}
bool LiveKitPublisher::connected() const noexcept { return impl_->connected(); }
bool LiveKitPublisher::video_published() const noexcept { return impl_->video_published(); }
std::uint64_t LiveKitPublisher::dropped_frames() const noexcept { return impl_->dropped_frames(); }
std::uint64_t LiveKitPublisher::dropped_video_frames() const noexcept {
    return impl_->dropped_video_frames();
}
std::wstring LiveKitPublisher::last_error() const { return impl_->last_error(); }

LiveKitPublisher& publisher() {
    static LiveKitPublisher instance;
    return instance;
}

}  // namespace qsession::media
