import Foundation

actor QSessionAPI {
    private let baseURL = URL(string: "https://qsession.org")!
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder: JSONDecoder

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.httpAdditionalHeaders = ["User-Agent": "QSession-Host-macOS/0.1"]
        session = URLSession(configuration: configuration)
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    func createRoom(_ request: CreateRoomRequest) async throws -> CreateRoomResponse {
        try await post(path: "/api/rooms", body: request)
    }

    func mediaCredentials(code: String, hostToken: String) async throws -> MediaCredentials {
        try await post(path: "/api/rooms/\(code)/media-token", body: MediaTokenRequest(role: "dj", hostToken: hostToken))
    }

    func startBroadcastDelivery(code: String, hostToken: String) async throws {
        let _: EmptyResponse = try await post(
            path: "/api/rooms/\(code)/broadcast/start",
            body: EndRoomRequest(hostToken: hostToken)
        )
    }

    func endRoom(code: String, hostToken: String) async throws {
        let _: EmptyResponse = try await post(path: "/api/rooms/\(code)/end", body: EndRoomRequest(hostToken: hostToken))
    }

    private func post<Request: Encodable, Response: Decodable>(path: String, body: Request) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw QSessionError.message("Q Session no devolvió una respuesta válida.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? decoder.decode(APIErrorPayload.self, from: data).error)
                ?? "Q Session no pudo completar la operación."
            throw QSessionError.message(message)
        }
        return try decoder.decode(Response.self, from: data)
    }
}
private struct MediaTokenRequest: Encodable { let role: String; let hostToken: String }
private struct EndRoomRequest: Encodable { let hostToken: String }

private struct EmptyResponse: Decodable {
    init(from decoder: Decoder) throws { }
}
