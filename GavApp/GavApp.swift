import SwiftUI
import WebKit

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
struct CatView {
    func makeWebView() -> WKWebView {
        let web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        #if os(iOS)
        web.scrollView.isScrollEnabled = false
        web.isOpaque = false
        #endif
        return web
    }
}

#if os(macOS)
extension CatView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView() }
    func updateNSView(_ view: WKWebView, context: Context) {}
}
#else
extension CatView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView() }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
#endif
