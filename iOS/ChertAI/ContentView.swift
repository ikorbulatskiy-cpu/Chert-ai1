import SwiftUI
import SafariServices

struct ContentView: View {
    @State private var tokenInput = ""
    @State private var pastedText = ""
    @State private var status: APIStatus?
    @State private var reply = ""
    @State private var notice = "Введи API-токен backend, чтобы подключиться."
    @State private var busy = false
    @State private var showGalaxy = false

    private let api = APIClient.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    connectionCard
                    statusCard
                    galaxyCard
                    importCard
                    if !reply.isEmpty { replyCard }
                    Text("Сейчас доступен ручной импорт видимого текста. Автоматическое чтение переписки и отправка сообщений Galaxy не подключены: подтверждённого API для этого проекта пока нет.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                }
                .padding()
            }
            .background(Color(red: 0.055, green: 0.06, blue: 0.08))
            .navigationBarHidden(true)
            .task { await refreshStatus() }
            .sheet(isPresented: $showGalaxy) {
                SafariView(url: URL(string: "https://galaxy.mobstudio.ru/web/")!)
                    .ignoresSafeArea()
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("ЧЁРТ").font(.system(size: 27, weight: .black, design: .rounded))
                Text("AI").font(.system(size: 27, weight: .black, design: .rounded)).foregroundStyle(.purple)
                Spacer()
                Circle().fill(status == nil ? .orange : .green).frame(width: 9, height: 9)
                Text(status == nil ? "НЕ ПОДКЛЮЧЁН" : "BACKEND ONLINE")
                    .font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            }
            Text("ТВОЙ ИГРОВОЙ НАПАРНИК").font(.caption.weight(.semibold)).tracking(2).foregroundStyle(.secondary)
        }
        .padding(.top, 12)
    }

    private var connectionCard: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                SecureField("API-токен Render (32+ символа)", text: $tokenInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                HStack {
                    Button("Подключить") {
                        Task {
                            do {
                                try api.saveToken(tokenInput.trimmingCharacters(in: .whitespacesAndNewlines))
                                tokenInput = ""
                                await refreshStatus()
                            } catch { notice = error.localizedDescription }
                        }
                    }.buttonStyle(.borderedProminent).tint(.purple)
                    Button("Отключить") { api.clearToken(); status = nil; notice = "Токен удалён с устройства." }
                        .buttonStyle(.bordered)
                }
                Text(notice).font(.caption).foregroundStyle(.secondary)
            }
        } label: { Label("Защищённое подключение", systemImage: "lock.shield") }
    }

    private var statusCard: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                statusLine("Backend", status?.backend.uppercased() ?? "НЕ ПРОВЕРЕН")
                statusLine("ИИ", status?.ai.configured == true ? "НАСТРОЕН · \(status?.ai.model ?? "")" : "НЕ НАСТРОЕН")
                statusLine("Worker", status?.bot.running == true ? "ЗАПУЩЕН (HEARTBEAT)" : "ОСТАНОВЛЕН")
                statusLine("Galaxy", status?.galaxy.state ?? "НЕ ПРОВЕРЕН")
                if let detail = status?.galaxy.detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                HStack {
                    Button("Обновить") { Task { await refreshStatus() } }.buttonStyle(.bordered)
                    Button("Запустить worker") { Task { await setWorker(true) } }.buttonStyle(.bordered)
                    Button("Остановить") { Task { await setWorker(false) } }.buttonStyle(.bordered)
                }.font(.caption)
            }
        } label: { Label("Состояние системы", systemImage: "waveform.path") }
    }

    private var galaxyCard: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                Text("Открой Galaxy внутри приложения. Войди обычным способом и скопируй нужные сообщения.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button { showGalaxy = true } label: {
                    Label("Открыть официальный Galaxy", systemImage: "globe")
                        .frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).tint(.purple)
            }
        } label: { Label("Galaxy", systemImage: "gamecontroller") }
    }

    private var importCard: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                Text("Вставь скопированный текст переписки. Он отправится на твой backend для разбора.")
                    .font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $pastedText)
                    .frame(minHeight: 130)
                    .scrollContentBackground(.hidden)
                    .padding(6)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                Button {
                    Task { await importText() }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(.white) }
                        Text(busy ? "Обработка…" : "Импортировать и получить ответ ИИ")
                    }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(.purple).disabled(busy || pastedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        } label: { Label("Сообщения и ответ", systemImage: "text.bubble") }
    }

    private var replyCard: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                Text(reply).textSelection(.enabled)
                Button {
                    UIPasteboard.general.string = reply
                    notice = "Черновик скопирован."
                } label: { Label("Скопировать черновик", systemImage: "doc.on.doc") }
                    .buttonStyle(.bordered)
            }
        } label: { Label("Черновик ответа · не отправлен", systemImage: "sparkles") }
    }

    private func statusLine(_ title: String, _ value: String) -> some View {
        HStack { Text(title).foregroundStyle(.secondary); Spacer(); Text(value).fontWeight(.semibold).multilineTextAlignment(.trailing) }
            .font(.caption)
    }

    @MainActor private func refreshStatus() async {
        do {
            status = try await api.status()
            notice = "Backend подключён. Токен хранится в системном Keychain."
        } catch { notice = error.localizedDescription }
    }

    @MainActor private func setWorker(_ running: Bool) async {
        do { try await api.setWorker(running: running); await refreshStatus() }
        catch { notice = error.localizedDescription }
    }

    @MainActor private func importText() async {
        busy = true
        defer { busy = false }
        do {
            let result = try await api.importAndProcess(pastedText)
            reply = result.processed.replyDraft?.text ?? "Не удалось сформировать ответ по этому тексту."
            notice = result.processed.ai?.used == true ? "Ответ создан через ИИ." : "Ответ создан резервным шаблоном. Проверь настройки OpenAI на backend."
            pastedText = ""
        } catch { notice = error.localizedDescription }
    }
}

private struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
