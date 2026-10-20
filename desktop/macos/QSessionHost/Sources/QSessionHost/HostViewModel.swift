import Foundation
import SwiftUI

@MainActor
final class HostViewModel: ObservableObject {
    @Published var roomName = "Mi sesión en vivo"
    @Published var hostName = "Anfitrión"
    @Published var roomKind: RoomKind = .party { didSet { applyPreset() } }
    @Published var visibility: RoomVisibility = .public
    @Published var password = ""
    @Published var cameraEnabled = false
    @Published var chat = true
    @Published var guestCameras = true
    @Published var socialProfiles = true
    @Published var matchmaking = true
    @Published var gifts = true
    @Published var status = "Lista para crear una sala"
    @Published var session: ActiveSession?
    @Published var busy = false
    @Published var errorMessage: String?

    private let api = QSessionAPI()
    private let publisher = LiveKitPublisher()
    private let secureStore = SecureSessionStore()

    init() {
        session = secureStore.load()
    }

    func start() async {
        guard !busy else { return }
        guard roomName.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2,
              hostName.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else {
            errorMessage = "Escribe el nombre de la sesión y del anfitrión."
            return
        }
        busy = true
        status = "Creando la sala…"
        do {
            let request = CreateRoomRequest(
                name: roomName,
                djName: hostName,
                roomType: roomKind.rawValue,
                visibility: visibility.rawValue,
                password: password.isEmpty ? nil : password,
                allowPublicChat: chat,
                allowGuestCameras: guestCameras,
                allowSocialProfiles: socialProfiles,
                allowMatchmaking: socialProfiles && matchmaking,
                allowProfileGifts: socialProfiles && gifts,
                timeZone: TimeZone.current.identifier
            )
            let created = try await api.createRoom(request)
            guard created.mediaConfigured else { throw QSessionError.message("El servidor multimedia no está disponible.") }
            status = "Conectando audio…"
            let media = try await api.mediaCredentials(code: created.room.code, hostToken: created.hostToken)
            try await publisher.connect(url: media.url, token: media.token, camera: cameraEnabled)
            try? await api.startBroadcastDelivery(code: created.room.code, hostToken: created.hostToken)
            let active = ActiveSession(
                code: created.room.code,
                hostToken: created.hostToken,
                joinUrl: created.joinUrl.isEmpty ? "https://qsession.org/?room=\(created.room.code)" : created.joinUrl,
                name: created.room.name,
                startedAt: Date(),
                cameraEnabled: cameraEnabled
            )
            try secureStore.save(active)
            session = active
            status = "En vivo · puedes minimizar esta ventana"
        } catch {
            status = "No se pudo iniciar"
            errorMessage = error.localizedDescription
            await publisher.disconnect()
        }
        busy = false
    }

    func recover() async {
        guard !busy, let saved = secureStore.load() else { return }
        busy = true
        do {
            status = "Recuperando la sala…"
            let media = try await api.mediaCredentials(code: saved.code, hostToken: saved.hostToken)
            try await publisher.connect(url: media.url, token: media.token, camera: saved.cameraEnabled)
            try? await api.startBroadcastDelivery(code: saved.code, hostToken: saved.hostToken)
            session = saved
            status = "En vivo · conexión recuperada"
        } catch {
            errorMessage = error.localizedDescription
            status = "No se pudo recuperar la sala"
        }
        busy = false
    }

    func stop() async {
        guard !busy, let active = session else { return }
        busy = true
        status = "Finalizando…"
        await publisher.disconnect()
        do { try await api.endRoom(code: active.code, hostToken: active.hostToken) }
        catch { errorMessage = error.localizedDescription }
        secureStore.clear()
        session = nil
        status = "Lista para crear una sala"
        busy = false
    }

    private func applyPreset() {
        let preset = RoomFeaturePreset.forKind(roomKind)
        chat = preset.chat
        guestCameras = preset.guestCameras
        socialProfiles = preset.socialProfiles
        matchmaking = preset.matchmaking
        gifts = preset.gifts
        if roomKind == .hotel { visibility = .private }
    }
}
