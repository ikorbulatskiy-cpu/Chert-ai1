import Foundation
import Security

struct APIStatus: Decodable {
    struct Bot: Decodable { let running: Bool; let uptimeSeconds: Int? }
    struct AI: Decodable { let configured: Bool; let model: String? }
    struct Galaxy: Decodable { let state: String; let detail: String?; let httpStatus: Int? }
    let backend: String
    let bot: Bot
    let ai: AI
    let galaxy: Galaxy
    let time: String
}

struct ProcessResponse: Decodable {
    struct Processed: Decodable {
        struct Draft: Decodable { let text: String; let status: String? }
        let messageCount: Int
        let replyDraft: Draft?
        let ai: AIResult?
    }
    struct AIResult: Decodable { let used: Bool; let model: String? }
    let processed: Processed
}

enum APIError: LocalizedError {
    case invalidURL, unauthorized, server(String), missingToken
    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Неверный адрес сервера."
        case .unauthorized: return "API-токен не принят. Проверь токен в настройках Render."
        case .server(let message): return message
        case .missingToken: return "Сначала сохрани API-токен."
        }
    }
}

final class APIClient {
    static let shared = APIClient()
    private let baseURL = "https://chert-ai1.onrender.com"
    private let keychainService = "ru.chertai.api"
    private let tokenAccount = "backend-token"

    private init() {}

    var hasToken: Bool { (try? loadToken()) != nil }

    func saveToken(_ token: String) throws {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: tokenAccount
        ]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw APIError.server("Не удалось сохранить токен в Keychain: \(status)")
        }
    }

    func clearToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: tokenAccount
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func loadToken() throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: tokenAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data,
              let token = String(data: data, encoding: .utf8), !token.isEmpty else {
            throw APIError.missingToken
        }
        return token
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        guard let url = URL(string: baseURL + path) else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + (try loadToken()), forHTTPHeaderField: "Authorization")
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.server("Нет HTTP-ответа.") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if !(200...299).contains(http.statusCode) {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.server(message ?? "Ошибка сервера HTTP \(http.statusCode).")
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.server("Сервер вернул неожиданный ответ: \(error.localizedDescription)") }
    }

    func status() async throws -> APIStatus { try await request("/api/status") }

    func importAndProcess(_ text: String) async throws -> ProcessResponse {
        struct ImportBody: Encodable { let text: String; let pageTitle: String; let pageUrl: String }
        struct ImportResult: Decodable { let ok: Bool }
        let payload = try JSONEncoder().encode(ImportBody(text: text, pageTitle: "Импорт из Chert AI iOS", pageUrl: "https://galaxy.mobstudio.ru/web/"))
        let _: ImportResult = try await request("/api/galaxy/import", method: "POST", body: payload)
        struct Empty: Encodable {}
        return try await request("/api/galaxy/process", method: "POST", body: JSONEncoder().encode(Empty()))
    }

    func setWorker(running: Bool) async throws {
        struct Empty: Encodable {}
        struct Result: Decodable { let ok: Bool }
        let _: Result = try await request(running ? "/api/bot/start" : "/api/bot/stop", method: "POST", body: JSONEncoder().encode(Empty()))
    }
}
