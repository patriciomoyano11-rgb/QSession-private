import Foundation
import LiveKit

@MainActor
final class LiveKitPublisher {
    private let room = Room()

    var connected: Bool { room.connectionState == .connected }

    func connect(url: String, token: String, camera: Bool) async throws {
        try await room.connect(url: url, token: token)
        try await room.localParticipant.setMicrophone(enabled: true)
        if camera {
            try await room.localParticipant.setCamera(enabled: true)
        }
    }

    func disconnect() async {
        try? await room.localParticipant.setCamera(enabled: false)
        try? await room.localParticipant.setMicrophone(enabled: false)
        await room.disconnect()
    }
}
