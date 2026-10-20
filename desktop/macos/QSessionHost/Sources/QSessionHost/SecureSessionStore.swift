import Foundation
import Security

struct SecureSessionStore {
    private let service = "org.qsession.host"
    private let account = "active-room"

    func save(_ session: ActiveSession) throws {
        let data = try JSONEncoder().encode(session)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let update: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var inserted = query
            inserted[kSecValueData as String] = data
            guard SecItemAdd(inserted as CFDictionary, nil) == errSecSuccess else {
                throw QSessionError.message("No se pudo proteger la recuperación de la sala en Keychain.")
            }
        } else if status != errSecSuccess {
            throw QSessionError.message("No se pudo actualizar la recuperación segura de la sala.")
        }
    }

    func load() -> ActiveSession? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(ActiveSession.self, from: data)
    }

    func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
