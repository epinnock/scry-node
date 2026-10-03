// ScryLaunch.swift - lets scripts/capture.sh ask the app for one screen by id.
//
//   launch with `-ScryScreen <id>`  -> the app renders only that screen, with no animation, and prints
//                                      `scry:ready <id>` once it is on screen
//   launch with `-ScryList YES`     -> the app prints `scry:screens <json>` (the registry) and exits
//   any other launch                -> unchanged
//
// Everything here is compiled only in Debug (`#if DEBUG`); a Release build contains a pass-through
// `ScryLaunchRoot` and none of the capture code or strings.
import SwiftUI

#if DEBUG
import UIKit

enum ScryLaunch {
    /// The id passed as `-ScryScreen <id>`, or nil in a normal launch.
    static var requestedScreen: String? { UserDefaults.standard.string(forKey: "ScryScreen") }
    static var listRequested: Bool { UserDefaults.standard.bool(forKey: "ScryList") }

    /// One line on stdout, flushed: stdout is block-buffered when it is not a terminal.
    static func emit(_ line: String) {
        print(line)
        fflush(stdout)
    }

    static func printRegistry() {
        let rows: [[String: Any]] = ScryScreens.all.map {
            ["id": $0.id, "name": $0.name, "kind": $0.kind, "title": $0.title, "file": $0.file, "line": $0.line]
        }
        let data = (try? JSONSerialization.data(withJSONObject: rows, options: [.sortedKeys])) ?? Data("[]".utf8)
        emit("scry:screens " + String(decoding: data, as: UTF8.self))
    }
}

/// Fixed canvas for one captured screen: light mode, default text size, no animation.
struct ScryCaptureRoot: View {
    let id: String

    var body: some View {
        Group {
            if let screen = ScryScreens.all.first(where: { $0.id == id }) {
                screen.view.onAppear {
                    // Give SwiftUI one layout pass before telling capture.sh to take the screenshot.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { ScryLaunch.emit("scry:ready \(id)") }
                }
            } else {
                Text("unknown screen: \(id)").onAppear { ScryLaunch.emit("scry:unknown \(id)") }
            }
        }
        .transaction { $0.animation = nil }
        .preferredColorScheme(.light)
        .environment(\.dynamicTypeSize, .large)
        .onAppear { UIView.setAnimationsEnabled(false) }
    }
}

struct ScryLaunchRoot<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        if let id = ScryLaunch.requestedScreen {
            ScryCaptureRoot(id: id)
        } else if ScryLaunch.listRequested {
            Color.clear.onAppear {
                ScryLaunch.printRegistry()
                exit(0)
            }
        } else {
            content()
        }
    }
}
#else
struct ScryLaunchRoot<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View { content() }
}
#endif
