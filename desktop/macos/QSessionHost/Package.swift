// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "QSessionHost",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "QSessionHost", targets: ["QSessionHost"]),
    ],
    dependencies: [
        .package(
            name: "LiveKit",
            url: "https://github.com/livekit/client-sdk-swift.git",
            .upToNextMajor(from: "2.16.0")
        ),
    ],
    targets: [
        .executableTarget(
            name: "QSessionHost",
            dependencies: ["LiveKit"],
            path: "Sources/QSessionHost"
        ),
    ]
)
