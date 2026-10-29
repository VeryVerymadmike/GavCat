import SwiftUI
import WebKit

#if os(macOS)
@main
struct GavApp: App {
    var body: some Scene {
        WindowGroup {
            MacCatView()
                .frame(minWidth: 480, minHeight: 320)
        }
        .defaultSize(width: 900, height: 600)
    }
}

struct MacCatView: NSViewRepresentable {
    func makeCoordinator() -> MacCatCoordinator { MacCatCoordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(WKUserScript(
            source: "document.documentElement.classList.add('app-mode')",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.underPageBackgroundColor = .white
        web.navigationDelegate = context.coordinator
        context.coordinator.load(web)
        return web
    }

    func updateNSView(_ web: WKWebView, context: Context) {}
}

final class MacCatCoordinator: NSObject, WKNavigationDelegate {
    private var onSite = false

    func load(_ web: WKWebView) {
        onSite = true
        web.load(URLRequest(url: siteURL, cachePolicy: .reloadRevalidatingCacheData))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard onSite, (error as NSError).code != NSURLErrorCancelled,
              let file = Bundle.main.url(forResource: "index", withExtension: "html") else { return }
        onSite = false
        webView.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
    }
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

let siteURL = URL(string: "https://veryverymadmike.github.io/GavCat/?app")!
