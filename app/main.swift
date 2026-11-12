// JARVIS — native window shell.
// A small Cocoa app that starts the local server (server.mjs), shows the interface in a
// frameless window, and adds what a browser cannot do: Apple speech recognition,
// an always-on-top compact mode and a global talk shortcut.
// Built by build-app.sh with the Swift compiler from Apple's Command Line Tools.

import Cocoa
import WebKit
import Speech
import AVFoundation
import Carbon.HIToolbox
import ServiceManagement
import ApplicationServices

let PORT = 4317
let BASE = URL(string: "http://127.0.0.1:\(PORT)/")!
let DATA = (NSHomeDirectory() as NSString).appendingPathComponent("JARVIS")

// MARK: - Voice input (Apple Speech framework)

final class SpeechIn {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var text = ""
    private var peak: Float = 0
    private var active = false      // a recognition is running
    private var starting = false    // waiting for permission or the microphone
    private var stopWanted = false  // released before the microphone was ready
    var onEvent: (([String: Any]) -> Void)?

    private var vocabulary: [String] = []

    func start(lang: String, vocabulary: [String] = []) {
        guard !active, !starting else { return }
        self.vocabulary = vocabulary
        starting = true; stopWanted = false
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    self.fail("Speech recognition is not allowed. Enable JARVIS in System Settings → Privacy & Security → Speech Recognition.")
                    return
                }
                AVCaptureDevice.requestAccess(for: .audio) { ok in
                    DispatchQueue.main.async {
                        guard ok else {
                            self.fail("Microphone access is not allowed. Enable JARVIS in System Settings → Privacy & Security → Microphone.")
                            return
                        }
                        self.begin(lang: lang)
                    }
                }
            }
        }
    }

    private func fail(_ message: String) {
        starting = false
        onEvent?(["error": message])
    }

    private func begin(lang: String) {
        guard starting else { return }
        if stopWanted { starting = false; onEvent?(["final": "", "peak": 0]); return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)), recognizer.isAvailable else {
            fail("Speech recognition is not available for \(lang) right now. It needs an internet connection unless the language is downloaded for dictation.")
            return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if !vocabulary.isEmpty { req.contextualStrings = vocabulary }   // names and terms to expect
        request = req; text = ""; peak = 0

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else { fail("No microphone was found."); return }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            req.append(buffer)
            // track the loudest sample, to tell "silence" from "nothing was said"
            if let data = buffer.floatChannelData?[0] {
                var m: Float = 0
                for i in 0..<Int(buffer.frameLength) { m = max(m, abs(data[i])) }
                DispatchQueue.main.async { if let s = self, m > s.peak { s.peak = m } }
            }
        }
        engine.prepare()
        do { try engine.start() } catch {
            input.removeTap(onBus: 0)
            fail("The microphone could not be started: \(error.localizedDescription)")
            return
        }
        starting = false; active = true
        onEvent?(["started": true])
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, self.active else { return }
                if let r = result {
                    self.text = r.bestTranscription.formattedString
                    if r.isFinal { self.finish() } else { self.onEvent?(["partial": self.text]) }
                } else if error != nil {
                    self.finish()
                }
            }
        }
    }

    /// The user finished talking: close the audio and wait briefly for the final wording.
    func stop() {
        if starting { stopWanted = true; return }
        guard active else { return }
        engine.stop(); engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.finish() }
    }

    /// Throw away what was heard.
    func cancel() {
        if starting { stopWanted = true; return }
        guard active else { return }
        text = ""
        finish()
    }

    private func finish() {
        guard active else { return }
        active = false
        engine.stop(); engine.inputNode.removeTap(onBus: 0)
        task?.cancel(); task = nil; request = nil
        onEvent?(["final": text, "peak": Double(peak)])
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var readerWindow: NSWindow?      // the second window, for text to read; made the first time it is asked for
    var server: Process?
    var serverInput: Pipe?
    let speech = SpeechIn()
    var normalFrame = NSRect.zero
    var compact = false
    var hotKey: EventHotKeyRef?
    var writeHotKey: EventHotKeyRef?
    var statusItem: NSStatusItem?
    var menuBarOn = false     // keep running in the menu bar when the window is closed
    var appsOn = false        // may read the selection in other apps and paste into them

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        startServer()
        makeWindow()
        speech.onEvent = { [weak self] ev in self?.toPage(["speech": ev]) }
        registerHotkey()
        waitForServer(attempt: 0)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { !menuBarOn }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMain(); return true
    }

    @objc func showMain() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(web)
    }

    @objc func toggleMini() {
        showMain()
        toPage(["command": "mini"])
    }

    // MARK: menu bar icon

    func setMenuBar(_ on: Bool) {
        menuBarOn = on
        if on, statusItem == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            item.button?.title = "◉"
            item.button?.toolTip = "JARVIS"
            let menu = NSMenu()
            let show = menu.addItem(withTitle: "Show JARVIS", action: #selector(showMain), keyEquivalent: ""); show.target = self
            let mini = menu.addItem(withTitle: "Mini Mode", action: #selector(toggleMini), keyEquivalent: ""); mini.target = self
            menu.addItem(.separator())
            menu.addItem(withTitle: "Quit JARVIS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
            item.menu = menu
            statusItem = item
        } else if !on, let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
    }

    // MARK: other apps (needs the macOS Accessibility permission)

    /// The text selected in the app the user is working in, if that app exposes it.
    func selectedText() -> String? {
        guard AXIsProcessTrusted() else { return nil }
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let element = focused else { return nil }
        var selection: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element as! AXUIElement, kAXSelectedTextAttribute as CFString, &selection) == .success,
              let text = selection as? String, !text.isEmpty else { return nil }
        return String(text.prefix(8000))
    }

    /// Insert text at the cursor of the frontmost app: copy it, press Command-V, then put the old clipboard back.
    func paste(_ text: String) {
        guard AXIsProcessTrusted() else {
            toPage(["notice": "JARVIS needs the Accessibility permission to type into other apps. Enable it in System Settings → Privacy & Security → Accessibility."])
            return
        }
        let board = NSPasteboard.general
        let previous = board.string(forType: .string)
        board.clearContents()
        board.setString(text, forType: .string)
        let source = CGEventSource(stateID: .combinedSessionState)
        let down = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: true)
        let up = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: false)
        down?.flags = .maskCommand; up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap); up?.post(tap: .cghidEventTap)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            if let previous = previous { board.clearContents(); board.setString(previous, forType: .string) }
        }
    }

    func loginItemEnabled() -> Bool {
        if #available(macOS 13.0, *) { return SMAppService.mainApp.status == .enabled }
        return false
    }

    func sendStatus() {
        toPage(["status": ["accessibility": AXIsProcessTrusted(), "loginItem": loginItemEnabled()]])
    }

    func applicationWillTerminate(_ note: Notification) {
        speech.cancel()
        server?.terminate()
    }

    // MARK: server

    func findNode() -> String? {
        let home = NSHomeDirectory()
        let candidates = ["/usr/local/bin/node", "/opt/homebrew/bin/node", "\(home)/.local/bin/node", "\(home)/.volta/bin/node", "/usr/bin/node"]
        if let hit = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) { return hit }
        // last resort: ask the user's login shell (covers nvm and similar)
        let p = Process(); let out = Pipe()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh"); p.arguments = ["-ilc", "command -v node"]
        p.standardOutput = out; p.standardError = Pipe()
        guard (try? p.run()) != nil else { return nil }
        p.waitUntilExit()
        let found = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .split(separator: "\n").last.map(String.init) ?? ""
        return FileManager.default.isExecutableFile(atPath: found) ? found : nil
    }

    func startServer() {
        guard let node = findNode() else {
            let a = NSAlert(); a.messageText = "JARVIS needs Node.js"
            a.informativeText = "Install Node.js from nodejs.org, then open JARVIS again."
            a.runModal(); NSApp.terminate(nil); return
        }
        try? FileManager.default.createDirectory(atPath: DATA, withIntermediateDirectories: true)
        let logPath = (DATA as NSString).appendingPathComponent("jarvis.log")
        if !FileManager.default.fileExists(atPath: logPath) { FileManager.default.createFile(atPath: logPath, contents: nil) }
        let log = FileHandle(forWritingAtPath: logPath); log?.seekToEndOfFile()

        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [Bundle.main.resourcePath! + "/server.mjs"]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/usr/local/bin:/opt/homebrew/bin:\(NSHomeDirectory())/.local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        env["JARVIS_DATA"] = DATA
        env["JARVIS_SHELL"] = "native"   // the server opens no window and exits when this app does
        p.environment = env
        let input = Pipe(); p.standardInput = input; serverInput = input
        if let log = log { p.standardOutput = log; p.standardError = log }
        do { try p.run(); server = p } catch { NSLog("JARVIS: could not start the server: \(error)") }
    }

    func waitForServer(attempt: Int) {
        var req = URLRequest(url: BASE); req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { _, response, _ in
            DispatchQueue.main.async {
                if (response as? HTTPURLResponse)?.statusCode == 200 {
                    self.web.load(URLRequest(url: BASE))
                } else if attempt < 80 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForServer(attempt: attempt + 1) }
                } else {
                    let a = NSAlert(); a.messageText = "JARVIS could not start"
                    a.informativeText = "The local server did not respond. See ~/JARVIS/jarvis.log."
                    a.runModal(); NSApp.terminate(nil)
                }
            }
        }.resume()
    }

    // MARK: window

    func makeWindow() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "jarvis")
        config.mediaTypesRequiringUserActionForPlayback = []   // lets the listening tones play
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")          // no white flash before the page paints
        web.allowsMagnification = false

        let frame = NSRect(x: 0, y: 0, width: 1320, height: 860)
        window = NSWindow(contentRect: frame,
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true     // no grey bar: the page runs to the top edge
        window.titleVisibility = .hidden
        window.title = "JARVIS"
        window.backgroundColor = NSColor(red: 0.012, green: 0.027, blue: 0.051, alpha: 1)
        window.minSize = NSSize(width: 760, height: 520)
        window.contentView = web
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("JARVISMain")
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)
    }

    // The reader: a plain window beside the main one, showing the page the server keeps at /reader.
    // It is brought forward without taking the keyboard, so talking and typing carry on in the main window.
    func showReader() {
        if readerWindow == nil {
            let config = WKWebViewConfiguration()
            config.userContentController.add(self, name: "jarvis")
            let page = WKWebView(frame: .zero, configuration: config)
            page.navigationDelegate = self
            page.setValue(false, forKey: "drawsBackground")
            page.allowsMagnification = true
            let size = NSSize(width: 720, height: 860)
            let w = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable],
                             backing: .buffered, defer: false)
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .hidden
            w.title = "JARVIS Reader"
            w.backgroundColor = NSColor(red: 0.012, green: 0.027, blue: 0.051, alpha: 1)
            w.minSize = NSSize(width: 420, height: 320)
            w.contentView = page
            w.isReleasedWhenClosed = false
            // first time: at the right edge of the screen; afterwards wherever it was left
            let screen = (window.screen ?? NSScreen.main!).visibleFrame
            w.setFrame(NSRect(x: screen.maxX - size.width - 24, y: screen.maxY - min(size.height, screen.height - 48) - 24,
                              width: size.width, height: min(size.height, screen.height - 48)), display: false)
            w.setFrameAutosaveName("JARVISReader")
            page.load(URLRequest(url: BASE.appendingPathComponent("reader")))
            readerWindow = w
        }
        if readerWindow?.isMiniaturized == true { readerWindow?.deminiaturize(nil) }
        readerWindow?.orderFront(nil)
    }

    // Closing the main window closes the reader with it, so the app is never left with the reader alone.
    func windowWillClose(_ notification: Notification) {
        if (notification.object as? NSWindow) === window { readerWindow?.close() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === web else { return }   // the reader needs none of what follows
        window.makeFirstResponder(web)
        // Development aid: JARVIS_SNAPSHOT=/path.png saves a picture of the window a few seconds after loading.
        let env = ProcessInfo.processInfo.environment
        guard let path = env["JARVIS_SNAPSHOT"] else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            if let js = env["JARVIS_SNAPSHOT_JS"] { self.web.evaluateJavaScript(js, completionHandler: nil) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                self.web.takeSnapshot(with: nil) { image, _ in
                    if let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                       let png = rep.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: path))
                    }
                }
            }
        }
    }

    // Links to other sites open in the browser, never inside JARVIS.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.host != BASE.host || url.port != BASE.port {
            if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func setCompact(_ on: Bool) {
        guard on != compact else { return }
        compact = on
        for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            window.standardWindowButton(b)?.isHidden = on
        }
        if on {
            normalFrame = window.frame
            window.minSize = NSSize(width: 200, height: 220)
            window.level = .floating                                   // stays above other apps
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            let screen = (window.screen ?? NSScreen.main!).visibleFrame
            let size = NSSize(width: 260, height: 300)
            window.setFrame(NSRect(x: screen.maxX - size.width - 24, y: screen.maxY - size.height - 24,
                                   width: size.width, height: size.height), display: true, animate: true)
        } else {
            window.level = .normal
            window.collectionBehavior = []
            window.minSize = NSSize(width: 760, height: 520)
            window.setFrame(normalFrame, display: true, animate: true)
        }
    }

    // MARK: page <-> app

    func toPage(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.jarvisNative && window.jarvisNative(\(json))", completionHandler: nil)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "drag":
            if let event = NSApp.currentEvent, event.type == .leftMouseDown { window.performDrag(with: event) }
        case "compact":
            setCompact(body["on"] as? Bool ?? !compact)
        case "listenStart":
            speech.start(lang: body["lang"] as? String ?? "en-GB", vocabulary: body["vocabulary"] as? [String] ?? [])
        case "config":
            setMenuBar(body["menuBar"] as? Bool ?? false)
            appsOn = body["apps"] as? Bool ?? false
            sendStatus()
        case "accessibility":      // ask macOS to show its Accessibility prompt
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
            sendStatus()
        case "loginItem":
            if #available(macOS 13.0, *), let on = body["on"] as? Bool {
                do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } }
                catch { toPage(["notice": "Could not change the login item: \(error.localizedDescription)"]) }
            }
            sendStatus()
        case "status":
            sendStatus()
        case "paste":
            if let text = body["text"] as? String, !text.isEmpty { paste(text) }
        case "listenStop":
            speech.stop()
        case "listenCancel":
            speech.cancel()
        case "reader":
            showReader()
        case "readerClose":
            readerWindow?.close()
        default:
            break
        }
    }

    // MARK: global shortcuts
    // Control + Option + Space: talk.  Control + Option + Shift + Space: write at the cursor.

    func registerHotkey() {
        var spec = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
        ]
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            guard let event = event, let userData = userData else { return noErr }
            var key = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &key)
            let down = GetEventKind(event) == UInt32(kEventHotKeyPressed)
            let id = key.id
            let me = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async { me.hotkey(id: id, down: down) }
            return noErr
        }, 2, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
        let signature = OSType(0x4A525653) // "JRVS"
        RegisterEventHotKey(UInt32(kVK_Space), UInt32(controlKey | optionKey),
                            EventHotKeyID(signature: signature, id: 1), GetApplicationEventTarget(), 0, &hotKey)
        RegisterEventHotKey(UInt32(kVK_Space), UInt32(controlKey | optionKey | shiftKey),
                            EventHotKeyID(signature: signature, id: 2), GetApplicationEventTarget(), 0, &writeHotKey)
    }

    func hotkey(id: UInt32, down: Bool) {
        var payload: [String: Any] = ["hotkey": down ? "down" : "up", "mode": id == 2 ? "write" : "talk"]
        if down {
            let outside = !NSApp.isActive            // pressed while working in another app
            payload["outside"] = outside
            if outside, appsOn, let selection = selectedText() { payload["selection"] = selection }
        }
        toPage(payload)
    }

    // MARK: menu (gives Quit, and copy/paste inside text boxes)

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let app = NSMenu()
        app.addItem(withTitle: "Hide JARVIS", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(.separator())
        app.addItem(withTitle: "Quit JARVIS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = app

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
