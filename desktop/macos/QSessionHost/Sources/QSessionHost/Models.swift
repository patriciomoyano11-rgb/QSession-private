import Foundation

enum RoomVisibility: String, Codable, CaseIterable, Identifiable, Sendable {
    case `public`
    case `private`

    var id: String { rawValue }
    var label: String { self == .public ? "Pública · todos pueden verla" : "Privada · solo con acceso compartido" }
}

enum RoomKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case party
    case conference
    case `class`
    case workshop
    case networking
    case hotel
    case custom

    var id: String { rawValue }
    var label: String {
        switch self {
        case .party: "Fiesta o música"
        case .conference: "Conferencia"
        case .class: "Clase de yoga, baile o idiomas"
        case .workshop: "Taller o capacitación"
        case .networking: "Networking"
        case .hotel: "Hotel o experiencia privada"
        case .custom: "Personalizada"
        }
    }
}

struct RoomFeaturePreset: Sendable {
    let chat: Bool
    let guestCameras: Bool
    let socialProfiles: Bool
    let matchmaking: Bool
    let gifts: Bool

    static func forKind(_ kind: RoomKind) -> Self {
        switch kind {
        case .party: .init(chat: true, guestCameras: true, socialProfiles: true, matchmaking: true, gifts: true)
        case .conference: .init(chat: true, guestCameras: false, socialProfiles: false, matchmaking: false, gifts: false)
        case .class: .init(chat: true, guestCameras: true, socialProfiles: false, matchmaking: false, gifts: true)
        case .workshop: .init(chat: true, guestCameras: true, socialProfiles: false, matchmaking: false, gifts: false)
        case .networking: .init(chat: true, guestCameras: false, socialProfiles: true, matchmaking: true, gifts: false)
        case .hotel: .init(chat: false, guestCameras: false, socialProfiles: false, matchmaking: false, gifts: true)
        case .custom: .init(chat: true, guestCameras: true, socialProfiles: true, matchmaking: false, gifts: true)
        }
    }
}

struct CreateRoomRequest: Encodable, Sendable {
    let name: String
    let djName: String
    let roomType: String
    let visibility: String
    let password: String?
    let allowPublicChat: Bool
    let allowGuestCameras: Bool
    let allowSocialProfiles: Bool
    let allowMatchmaking: Bool
    let allowProfileGifts: Bool
    let timeZone: String
}

struct RoomDTO: Codable, Sendable {
    let code: String
    let name: String
    let djName: String
    let roomType: String
    let visibility: String
    let status: String
    let startedAt: String?
}

struct CreateRoomResponse: Decodable, Sendable {
    let ok: Bool
    let room: RoomDTO
    let hostToken: String
    let joinUrl: String
    let mediaConfigured: Bool
}

struct MediaCredentials: Decodable, Sendable {
    let ok: Bool
    let url: String
    let token: String
}

struct ActiveSession: Codable, Sendable {
    let code: String
    let hostToken: String
    let joinUrl: String
    let name: String
    let startedAt: Date
    let cameraEnabled: Bool
}

struct APIErrorPayload: Decodable, Sendable {
    let error: String
}

enum QSessionError: LocalizedError, Sendable {
    case message(String)

    var errorDescription: String? {
        switch self { case let .message(message): message }
    }
}
