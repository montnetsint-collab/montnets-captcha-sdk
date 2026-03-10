import UIKit

/**
 * Demo ViewController — shows how to integrate MontnetsCaptcha into a login screen.
 *
 * In a real app:
 *   • Replace fetchCaptchaToken() with a call to your own backend endpoint.
 *   • Your backend holds appSecret and calls POST /captcha/init server-to-server.
 *   • After onSuccess, call your backend's login API with captchaToken.
 */
class ViewController: UIViewController {

    // ── Configuration — replace with your actual values ──────────────────────
    let captchaServerUrl = "https://captcha-api.example.com"
    let appId            = "YOUR_APP_ID"
    // ─────────────────────────────────────────────────────────────────────────

    private let usernameField = UITextField()
    private let passwordField = UITextField()
    private let loginButton   = UIButton(type: .system)
    private let statusLabel   = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }

    // ── Trigger captcha when the user taps Sign In ────────────────────────────
    @objc func handleLogin() {
        guard
            let username = usernameField.text, !username.isEmpty,
            let password = passwordField.text, !password.isEmpty
        else {
            statusLabel.text = "Please enter username and password."
            return
        }

        loginButton.isEnabled = false
        statusLabel.text = "Opening captcha…"

        // ── Show the sliding-puzzle captcha modal ─────────────────────────────
        MontnetsCaptcha.show(
            from:      self,
            serverUrl: captchaServerUrl,

            // tokenProvider: call YOUR backend endpoint to get an accessToken.
            // NEVER embed appSecret in the app.
            tokenProvider: { [weak self] completion in
                self?.fetchCaptchaToken(completion: completion)
            },

            // onSuccess: the user passed the challenge.
            // In a real app, send captchaToken + credentials to your backend.
            onSuccess: { [weak self] captchaToken in
                self?.statusLabel.text =
                    "✓ Captcha passed!\n\ncaptchaToken:\n\(captchaToken)\n\n" +
                    "→ Your backend should call POST /captcha/token/check to verify it,\n" +
                    "  then proceed with login."
                self?.loginButton.isEnabled = true
                // MyServer.login(username: username, password: password, captchaToken: captchaToken)
            },

            onError: { [weak self] message in
                self?.statusLabel.text = "✗ Captcha error: \(message)"
                self?.loginButton.isEnabled = true
            },

            onClose: { [weak self] in
                // Re-enable the button if the user dismissed without completing
                if self?.loginButton.isEnabled == false {
                    self?.loginButton.isEnabled = true
                }
            }
        )
    }

    /**
     * Obtains a captcha accessToken.
     *
     * ⚠ DEMO ONLY — this implementation calls POST /captcha/init directly from
     * the app, which requires the appSecret to be present here.  In production,
     * create a backend endpoint (e.g. GET /api/captcha-token) that holds the
     * appSecret securely and returns only the accessToken.
     */
    func fetchCaptchaToken(completion: @escaping (String?, String?) -> Void) {
        guard let url = URL(string: "\(captchaServerUrl)/captcha/init") else {
            completion(nil, "Invalid server URL"); return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "appId":     appId,
            "appSecret": "YOUR_APP_SECRET",  // ← DEMO ONLY — move to your backend
            "timestamp": Int(Date().timeIntervalSince1970 * 1000),
            "nonce":     UUID().uuidString
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { data, _, error in
            if let error = error { completion(nil, error.localizedDescription); return }
            guard
                let data = data,
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { completion(nil, "Invalid response"); return }

            if json["success"] as? Bool == true,
               let dataObj = json["data"] as? [String: Any],
               let token   = dataObj["accessToken"] as? String {
                completion(token, nil)
            } else {
                completion(nil, json["message"] as? String ?? "Failed to obtain token")
            }
        }.resume()
    }

    // MARK: - UI Setup

    func setupUI() {
        view.backgroundColor = UIColor(red: 0.94, green: 0.96, blue: 1.0, alpha: 1)

        let titleLabel = UILabel()
        titleLabel.text          = "Montnets Captcha Demo"
        titleLabel.font          = .boldSystemFont(ofSize: 22)
        titleLabel.textColor     = UIColor(red: 0.12, green: 0.15, blue: 0.27, alpha: 1)
        titleLabel.textAlignment = .center

        let subtitleLabel = UILabel()
        subtitleLabel.text          = "Enter any credentials and tap Sign In."
        subtitleLabel.font          = .systemFont(ofSize: 13)
        subtitleLabel.textColor     = UIColor(red: 0.55, green: 0.60, blue: 0.75, alpha: 1)
        subtitleLabel.textAlignment = .center

        configureTextField(usernameField, placeholder: "Username", isSecure: false)
        configureTextField(passwordField, placeholder: "Password", isSecure: true)

        loginButton.setTitle("Sign In", for: .normal)
        loginButton.backgroundColor   = UIColor(red: 0.26, green: 0.38, blue: 0.93, alpha: 1)
        loginButton.setTitleColor(.white, for: .normal)
        loginButton.titleLabel?.font  = .boldSystemFont(ofSize: 16)
        loginButton.layer.cornerRadius = 10
        loginButton.addTarget(self, action: #selector(handleLogin), for: .touchUpInside)

        statusLabel.numberOfLines = 0
        statusLabel.font          = .systemFont(ofSize: 13)
        statusLabel.textColor     = UIColor(red: 0.29, green: 0.33, blue: 0.47, alpha: 1)

        let stack = UIStackView(arrangedSubviews: [
            titleLabel, subtitleLabel, usernameField, passwordField, loginButton, statusLabel
        ])
        stack.axis      = .vertical
        stack.spacing   = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            usernameField.heightAnchor.constraint(equalToConstant: 48),
            passwordField.heightAnchor.constraint(equalToConstant: 48),
            loginButton.heightAnchor.constraint(equalToConstant: 50)
        ])
    }

    func configureTextField(_ tf: UITextField, placeholder: String, isSecure: Bool) {
        tf.placeholder          = placeholder
        tf.isSecureTextEntry    = isSecure
        tf.borderStyle          = .roundedRect
        tf.font                 = .systemFont(ofSize: 15)
        tf.autocapitalizationType = .none
        tf.autocorrectionType   = .no
    }
}
