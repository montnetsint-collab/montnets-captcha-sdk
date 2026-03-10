import UIKit
import WebKit

/**
 * Montnets International Sliding-Puzzle Captcha — iOS integration helper.
 *
 * ── Integration steps ──────────────────────────────────────────────────────
 *  1. Copy this file (MontnetsCaptcha.swift) into your Xcode project.
 *  2. Copy captcha_bridge.html into your Xcode project and make sure it is
 *     listed under Build Phases → Copy Bundle Resources.
 *  3. Call MontnetsCaptcha.show() from your login button handler.
 *
 * ── Example usage ──────────────────────────────────────────────────────────
 *  MontnetsCaptcha.show(
 *      from:      self,
 *      serverUrl: "https://captcha-api.example.com",
 *      tokenProvider: { completion in
 *          // Call YOUR backend endpoint to get an accessToken.
 *          // NEVER put appSecret in the app — keep it on your server.
 *          MyServer.getCaptchaToken { token, error in
 *              completion(token, error?.localizedDescription)
 *          }
 *      },
 *      onSuccess: { captchaToken in
 *          // Pass captchaToken to your backend for server-side verification.
 *          // Your backend calls POST /captcha/token/check.
 *          MyServer.login(username: username, password: password, captchaToken: captchaToken)
 *      }
 *  )
 */
public class MontnetsCaptcha: NSObject {

    /**
     * Presents the sliding-puzzle captcha as a full-screen modal.
     *
     * - Parameters:
     *   - viewController: The presenting UIViewController.
     *   - serverUrl:      Base URL of the Montnets Captcha service (no trailing slash).
     *                     Example: "https://captcha-api.example.com"
     *   - tokenProvider:  Called when the SDK needs a fresh accessToken.
     *                     Invoke completion(token, nil) on success or completion(nil, errorMessage) on failure.
     *                     May be called on any thread.
     *   - onSuccess:      Called on the main thread with the captchaToken when the user passes.
     *                     Pass the token to your backend: POST /captcha/token/check.
     *   - onError:        Called on the main thread when an unrecoverable error occurs (optional).
     *   - onClose:        Called on the main thread when the modal is dismissed (optional).
     */
    public static func show(
        from viewController: UIViewController,
        serverUrl: String,
        tokenProvider: @escaping (_ completion: @escaping (_ token: String?, _ error: String?) -> Void) -> Void,
        onSuccess: @escaping (_ captchaToken: String) -> Void,
        onError: ((_ message: String) -> Void)? = nil,
        onClose: (() -> Void)? = nil
    ) {
        let vc = CaptchaViewController(
            serverUrl:     serverUrl,
            tokenProvider: tokenProvider,
            onSuccess:     onSuccess,
            onError:       onError,
            onClose:       onClose
        )
        vc.modalPresentationStyle = .overFullScreen
        vc.modalTransitionStyle   = .crossDissolve
        viewController.present(vc, animated: true)
    }
}

// MARK: - Internal ViewController

private class CaptchaViewController: UIViewController, WKScriptMessageHandler {

    private let serverUrl:     String
    private let tokenProvider: (_ completion: @escaping (_ token: String?, _ error: String?) -> Void) -> Void
    private let onSuccess:     (_ captchaToken: String) -> Void
    private let onError:       ((_ message: String) -> Void)?
    private let onClose:       (() -> Void)?

    private var webView: WKWebView!
    private var closeFired = false  // guard against duplicate onClose calls

    init(
        serverUrl:     String,
        tokenProvider: @escaping (_ completion: @escaping (_ token: String?, _ error: String?) -> Void) -> Void,
        onSuccess:     @escaping (_ captchaToken: String) -> Void,
        onError:       ((_ message: String) -> Void)?,
        onClose:       (() -> Void)?
    ) {
        self.serverUrl     = serverUrl
        self.tokenProvider = tokenProvider
        self.onSuccess     = onSuccess
        self.onError       = onError
        self.onClose       = onClose
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not implemented") }

    // MARK: - Lifecycle

    deinit {
        // Must remove the script message handler to break the retain cycle:
        // CaptchaViewController → WKWebView → WKUserContentController → CaptchaViewController
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "captchaSDK")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.55)

        // Configure WKWebView with the "captchaSDK" script message handler.
        // Use WeakMessageHandler to avoid the retain cycle between
        // WKUserContentController and this view controller.
        let config = WKWebViewConfiguration()
        config.userContentController.add(WeakMessageHandler(self), name: "captchaSDK")

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        view.addSubview(webView)

        // Read captcha_bridge.html from the app bundle
        guard
            let htmlPath = Bundle.main.path(forResource: "captcha_bridge", ofType: "html"),
            let html     = try? String(contentsOfFile: htmlPath, encoding: .utf8),
            let baseURL  = URL(string: serverUrl)
        else {
            dismiss(animated: false) {
                self.onError?("captcha_bridge.html not found in app bundle. " +
                              "Make sure it is added to Build Phases → Copy Bundle Resources.")
            }
            return
        }

        // Load the bridge HTML with serverUrl as the base URL.
        // This makes "/montnets-captcha-sdk.js" resolve to the captcha server
        // and all subsequent fetch() calls appear same-origin.
        webView.loadHTMLString(html, baseURL: baseURL)
    }

    // MARK: - WKScriptMessageHandler

    /// Receives messages posted from JS via:
    ///   window.webkit.messageHandlers.captchaSDK.postMessage(JSON.stringify({type, ...}))
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard
            let body = message.body as? String,
            let data = body.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = json["type"] as? String
        else { return }

        switch type {

        case "requestToken":
            // JS is awaiting a token; call tokenProvider and deliver the result back.
            guard let callbackId = json["id"] as? Int else { return }
            tokenProvider { [weak self] token, error in
                guard let self = self else { return }
                DispatchQueue.main.async {
                    let js: String
                    if let error = error {
                        let safe = error.replacingOccurrences(of: "\\", with: "\\\\")
                                        .replacingOccurrences(of: "'", with: "\\'")
                        js = "__nativeDeliverToken(\(callbackId), null, '\(safe)')"
                    } else {
                        let safe = (token ?? "").replacingOccurrences(of: "\\", with: "\\\\")
                                               .replacingOccurrences(of: "'", with: "\\'")
                        js = "__nativeDeliverToken(\(callbackId), '\(safe)', null)"
                    }
                    self.webView.evaluateJavaScript(js, completionHandler: nil)
                }
            }

        case "onSuccess":
            guard let captchaToken = json["token"] as? String else { return }
            fireClose()
            DispatchQueue.main.async { [weak self] in
                self?.dismiss(animated: true) { self?.onSuccess(captchaToken) }
            }

        case "onError":
            let msg = json["message"] as? String ?? "Unknown error"
            fireClose()
            DispatchQueue.main.async { [weak self] in
                self?.dismiss(animated: true) { self?.onError?(msg) }
            }

        case "onClose":
            fireClose()
            DispatchQueue.main.async { [weak self] in
                self?.dismiss(animated: true, completion: nil)
            }

        default:
            break
        }
    }

    // MARK: - Private

    private func fireClose() {
        guard !closeFired else { return }
        closeFired = true
        DispatchQueue.main.async { [weak self] in self?.onClose?() }
    }
}

// MARK: - WeakMessageHandler

/**
 * Proxy that holds a weak reference to the real WKScriptMessageHandler delegate.
 *
 * WKUserContentController retains its message handlers strongly, which creates
 * a retain cycle when the handler is a WKWebView-owning view controller:
 *   ViewController → WKWebView → WKUserContentController → ViewController
 *
 * By inserting this proxy the cycle becomes:
 *   ViewController → WKWebView → WKUserContentController → WeakMessageHandler ⇢ (weak) ViewController
 * so the view controller can be deallocated normally.
 */
private class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
