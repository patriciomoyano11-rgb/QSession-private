import SwiftUI

struct ContentView: View {
    @StateObject private var model = HostViewModel()

    var body: some View {
        HStack(spacing: 0) {
            Form {
                Section("Nueva sesión") {
                    TextField("Nombre de la sesión", text: $model.roomName)
                    TextField("Anfitrión", text: $model.hostName)
                    Picker("Tipo", selection: $model.roomKind) {
                        ForEach(RoomKind.allCases) { Text($0.label).tag($0) }
                    }
                    Picker("Visibilidad", selection: $model.visibility) {
                        ForEach(RoomVisibility.allCases) { Text($0.label).tag($0) }
                    }
                    SecureField("Contraseña opcional", text: $model.password)
                }
                Section("Transmisión") {
                    LabeledContent("Fuente de audio", value: "Micrófono o interfaz")
                    Toggle("Transmitir mi cámara", isOn: $model.cameraEnabled)
                    Text("El audio de otras aplicaciones se añadirá con el adaptador ScreenCaptureKit después de validarlo en una Mac.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("Participación") {
                    Toggle("Chat público", isOn: $model.chat)
                    Toggle("Cámaras de invitados", isOn: $model.guestCameras)
                    Toggle("Perfiles sociales", isOn: $model.socialProfiles)
                    Toggle("Matchmaking", isOn: $model.matchmaking).disabled(!model.socialProfiles)
                    Toggle("Tips y detalles", isOn: $model.gifts).disabled(!model.socialProfiles)
                }
                Button("Crear sala e iniciar transmisión") { Task { await model.start() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.busy || model.session != nil)
            }
            .formStyle(.grouped)
            .frame(minWidth: 500)

            VStack(alignment: .leading, spacing: 22) {
                Text("Q SESSION")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color(red: 0.26, green: 0.66, blue: 0.70))
                Text(model.session?.name ?? "Tu señal aparecerá aquí")
                    .font(.system(size: 31, weight: .bold))
                Text(model.status).foregroundStyle(.secondary)
                Spacer()
                if let active = model.session {
                    Text("CÓDIGO DE LA SALA").font(.caption.weight(.bold))
                    Text(active.code).font(.system(size: 38, weight: .bold, design: .rounded))
                    Text(active.joinUrl).font(.caption).textSelection(.enabled)
                    Button("Finalizar transmisión", role: .destructive) { Task { await model.stop() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.busy)
                } else if SecureSessionStore().load() != nil {
                    Button("Recuperar la última sala") { Task { await model.recover() } }
                        .buttonStyle(.bordered)
                        .disabled(model.busy)
                }
                Spacer()
                Text("Minimizar esta ventana no interrumpe la transmisión.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(34)
            .frame(minWidth: 390, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color(red: 0.04, green: 0.12, blue: 0.23).opacity(0.06))
        }
        .frame(minWidth: 960, minHeight: 680)
        .alert("Q Session", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            Button("Aceptar") { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "")
        }
    }
}
