import SwiftUI
import WebKit

#if os(macOS)
// On the Mac the cat is the desktop wallpaper (see Desktop); the menu bar cat reloads it or quits.
@main
struct GavApp: App {
    @NSApplicationDelegateAdaptor(Desktop.self) var desktop
    var body: some Scene {
        MenuBarExtra("Gav", systemImage: "cat.fill") {
            Button("Reload") { desktop.reload() }
            Divider()
            Button("Quit Gav") { NSApp.terminate(nil) }
        }
    }
}

// The page: the GitHub Pages site, so the wallpaper follows main (it checks for a new version every half hour and on
// wake, see checkForUpdate); the copy bundled with the app when the site can't be reached. ?wallpaper: see-through
// background, no controls.
let siteURL = URL(string: "https://veryverymadmike.github.io/GavCat/?wallpaper")!

/* The cat as the desktop wallpaper: a see-through window behind the desktop icons, on every Space, that clicks pass
   through (like Plash). Such a window gets no mouse events, so the cursor is read here instead and handed to the page
   as ordinary pointer moves, only while it is over the bare desktop: not over a window, the Dock or the menu bar.
   Clicks there are handed on too (a click on the sleeping cat wakes it); they still reach the desktop as well. */
final class Desktop: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var activity: NSObjectProtocol?
    private var cursor: CGPoint?          // where the page last saw the cursor (page coordinates); nil: not over the desktop
    private var lastAt = CGPoint(x: -1, y: -1), ticks = 0
    private var onSite = false            // showing the site (not the bundled copy)
    private var version: String?          // the site's version shown (its ETag)
    private var clicks: Any?              // watches clicks in other apps (the desktop is Finder's)

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(.accessory)                 // no Dock icon, just the menu bar cat
        web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        web.setValue(false, forKey: "drawsBackground")       // the desktop picture shows behind the cat
        web.navigationDelegate = self
        window = NSWindow(contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
        window.level = NSWindow.Level(Int(CGWindowLevelForKey(.desktopWindow)))
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.ignoresMouseEvents = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.isReleasedWhenClosed = false
        window.contentView = web
        fit()
        window.orderBack(nil)
        reload()
        NotificationCenter.default.addObserver(self, selector: #selector(fit), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        // the cursor, 60 times a second (App Nap would slow that to a crawl)
        activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "The cat watches the cursor")
        let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.trackCursor() } }
        RunLoop.main.add(timer, forMode: .common)
        clicks = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] _ in MainActor.assumeIsolated { self?.click() } }
        // a new version of the cat: looked for every half hour, and a little after the Mac wakes (once the network is back)
        checkForUpdate()
        let updates = Timer(timeInterval: 30 * 60, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.checkForUpdate() } }
        RunLoop.main.add(updates, forMode: .common)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(woke), name: NSWorkspace.didWakeNotification, object: nil)
    }

    @objc private func woke() {
        Task { try? await Task.sleep(for: .seconds(15)); checkForUpdate() }
    }

    // asks the site for its version only (no page): reloads when it changed, or when the bundled copy is showing and
    // the site can be reached again; offline it waits for the next check
    private func checkForUpdate() {
        Task {
            var ask = URLRequest(url: siteURL, cachePolicy: .reloadIgnoringLocalCacheData)
            ask.httpMethod = "HEAD"
            guard let res = (try? await URLSession.shared.data(for: ask))?.1 as? HTTPURLResponse, res.statusCode == 200 else { return }
            let now = res.value(forHTTPHeaderField: "ETag") ?? res.value(forHTTPHeaderField: "Last-Modified")
            if !onSite || (version != nil && now != version) { reload() }
            version = now
        }
    }

    // the whole main display (the one with the menu bar)
    @objc func fit() {
        if let screen = NSScreen.screens.first { window.setFrame(screen.frame, display: true) }
    }

    func reload() {
        onSite = true
        web.load(URLRequest(url: siteURL, cachePolicy: .reloadRevalidatingCacheData))
    }

    // the site can't be reached: the bundled copy (not when a load was only cut short by the next one, e.g. Reload twice)
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard onSite, (error as NSError).code != NSURLErrorCancelled,
              let file = Bundle.main.url(forResource: "index", withExtension: "html"),
              var page = URLComponents(url: file, resolvingAgainstBaseURL: false) else { return }
        page.query = "wallpaper"
        onSite = false
        if let url = page.url { webView.loadFileURL(url, allowingReadAccessTo: file.deletingLastPathComponent()) }
    }

    // checked when the cursor moves, and a few times a second while it rests (a window may move away from under it)
    private func trackCursor() {
        let at = NSEvent.mouseLocation
        ticks += 1
        guard at != lastAt || ticks % 15 == 0 else { return }
        lastAt = at
        let f = window.frame, seen = f.contains(at) && overDesktop(at)
        let q = CGPoint(x: (at.x - f.minX).rounded(), y: (f.maxY - at.y).rounded())   // the page counts from the top left
        if seen, q != cursor {
            cursor = q
            run("dispatchEvent(new PointerEvent('pointermove', { clientX: \(Int(q.x)), clientY: \(Int(q.y)), pointerType: 'mouse' }))")
        } else if !seen, cursor != nil {
            cursor = nil
            run("document.documentElement.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))")
        }
    }

    // a click on the bare desktop, handed to the page where it was
    private func click() {
        let at = NSEvent.mouseLocation, f = window.frame
        guard f.contains(at), overDesktop(at) else { return }
        let q = CGPoint(x: (at.x - f.minX).rounded(), y: (f.maxY - at.y).rounded())
        run("dispatchEvent(new PointerEvent('pointerdown', { clientX: \(Int(q.x)), clientY: \(Int(q.y)), pointerType: 'mouse', button: 0 }))")
    }

    // the bare desktop under the cursor: the frontmost window there is the desktop or its icons
    private func overDesktop(_ at: CGPoint) -> Bool {
        let n = NSWindow.windowNumber(at: at, belowWindowWithWindowNumber: 0)
        guard n > 0, let info = CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(n)) as? [[String: Any]],
              let layer = info.first?[kCGWindowLayer as String] as? Int else { return true }
        return layer <= Int(CGWindowLevelForKey(.desktopIconWindow))
    }

    private func run(_ js: String) { web.evaluateJavaScript(js, completionHandler: nil) }
}
#else
@main
struct GavApp: App {
    var body: some Scene {
        WindowGroup {
            CatView()
                .ignoresSafeArea()
        }
    }
}

// Shows the bundled index.html (built from cat-stretch.html by build.sh).
struct CatView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        web.scrollView.isScrollEnabled = false
        web.isOpaque = false
        return web
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
#endif
