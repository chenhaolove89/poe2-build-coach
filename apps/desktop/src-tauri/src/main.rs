// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// The cookie the trade site keeps a logged-in session in, on every realm.
///
/// It is HttpOnly, so the page's own JavaScript cannot read it — only the
/// webview's cookie store can, which is what `read_session_cookie` is for.
/// That is also why this lives in Rust: @tauri-apps/api exposes no cookie
/// getter, so the frontend has no way to ask for it directly.
const SESSION_COOKIE: &str = "POESESSID";

/// One reusable login window, so repeated attempts do not pile up windows.
const LOGIN_LABEL: &str = "realm-login";

/// Open (or focus) a realm's real trade page so the player can log in with
/// their own account, the same way they would in a browser.
///
/// `origin` is the API origin the session cookie belongs to, which is also the
/// scope of the cookies cleared here.
///
/// Both this and [`read_session_cookie`] must stay `async`. On Windows,
/// building a webview and reading its cookies deadlock when called from a
/// synchronous command on the main thread — WebView2 has to be asked from the
/// thread that owns the window.
#[tauri::command]
async fn open_login_window(app: AppHandle, url: String, origin: String) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(LOGIN_LABEL) {
        // Already mid-attempt: just bring it forward and leave its cookies be.
        return existing.set_focus().map_err(|e| e.to_string());
    }
    let target: Url = url.parse().map_err(|e| format!("bad url {url}: {e}"))?;
    let scope: Url = origin.parse().map_err(|e| format!("bad origin {origin}: {e}"))?;
    let window = WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(target))
        .title("登录 / Sign in")
        .inner_size(1000.0, 760.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    // A previous attempt left its POESESSID in the cookie store, and an
    // expired one would be read straight back as if the player had just logged
    // in. Start logged out so only a cookie obtained during this attempt can
    // come back.
    for cookie in window.cookies_for_url(scope).map_err(|e| e.to_string())? {
        if cookie.name() == SESSION_COOKIE {
            window.delete_cookie(cookie).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Read the session cookie out of the login window's cookie store.
///
/// `Ok(None)` means the player has not finished logging in yet, which the
/// caller polls for. An error means the window is gone, i.e. the attempt was
/// abandoned.
#[tauri::command]
async fn read_session_cookie(app: AppHandle, origin: String) -> Result<Option<String>, String> {
    let window = app
        .get_webview_window(LOGIN_LABEL)
        .ok_or_else(|| "login window is not open".to_string())?;
    let target: Url = origin.parse().map_err(|e| format!("bad origin {origin}: {e}"))?;
    let cookies = window.cookies_for_url(target).map_err(|e| e.to_string())?;
    Ok(cookies
        .into_iter()
        .find(|cookie| cookie.name() == SESSION_COOKIE && !cookie.value().is_empty())
        .map(|cookie| format!("{}={}", cookie.name(), cookie.value())))
}

#[tauri::command]
async fn close_login_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LOGIN_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            open_login_window,
            read_session_cookie,
            close_login_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
