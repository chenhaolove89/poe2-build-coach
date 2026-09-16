// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

/// The cookie the trade site keeps a logged-in session in, on every realm.
///
/// It is HttpOnly, so the page's own JavaScript cannot read it — only the
/// webview's cookie store can, which is what `read_session_cookie` is for.
/// That is also why this lives in Rust: @tauri-apps/api exposes no cookie
/// getter, so the frontend has no way to ask for it directly.
const SESSION_COOKIE: &str = "POESESSID";

/// One reusable login window, so repeated attempts do not pile up windows.
const LOGIN_LABEL: &str = "realm-login";

/// The passive-tree overlay the player summons over the game.
const OVERLAY_LABEL: &str = "tree-overlay";

/// Key that shows and hides the overlay.
///
/// It reads nothing from the game: the player presses it, gets a reference
/// version of their tree, and presses it again. Nothing is drawn unless asked
/// for, and no game state is involved on either side.
fn overlay_shortcut() -> Shortcut {
    Shortcut::new(None, Code::F8)
}

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

/// Show or hide the tree overlay, creating it on first use.
///
/// Returns whether it is now visible. The window is transparent, borderless,
/// always on top and click-through: the player keeps playing, the game keeps
/// every click and every key. This is why it is a reference the player asks for
/// rather than something that follows the game — the app never learns anything
/// about the game's state, so nothing here can drift or interfere.
///
/// The game has to be in windowed or borderless mode; exclusive fullscreen
/// draws over every other window, ours included.
#[tauri::command]
async fn toggle_tree_overlay(app: AppHandle) -> Result<bool, String> {
    if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
        let visible = existing.is_visible().unwrap_or(false);
        if visible {
            existing.hide().map_err(|e| e.to_string())?;
        } else {
            existing.show().map_err(|e| e.to_string())?;
        }
        return Ok(!visible);
    }

    let window = WebviewWindowBuilder::new(
        &app,
        OVERLAY_LABEL,
        WebviewUrl::App("index.html?overlay=tree".into()),
    )
    .title("PoE2 Build Coach overlay")
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .fullscreen(true)
    .build()
    .map_err(|e| e.to_string())?;

    // Never take focus: stealing it would drop the game out of the foreground,
    // and the whole point is that play continues underneath.
    window.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Let the overlay accept clicks, or go back to passing them through.
///
/// Needed once the overlay shows anything interactive; until then it stays
/// click-through so the game keeps the mouse.
#[tauri::command]
async fn set_overlay_click_through(app: AppHandle, click_through: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| "overlay is not open".to_string())?;
    window
        .set_ignore_cursor_events(click_through)
        .map_err(|e| e.to_string())
}

/// Whether the overlay exists and is visible, so the app can show its state.
#[tauri::command]
async fn tree_overlay_visible(app: AppHandle) -> Result<bool, String> {
    Ok(app
        .get_webview_window(OVERLAY_LABEL)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let handle = app.clone();
                    // Window work has to stay off the main thread on Windows.
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = toggle_tree_overlay(handle).await {
                            eprintln!("overlay toggle failed: {err}");
                        }
                    });
                })
                .build(),
        )
        .setup(|app| {
            app.global_shortcut()
                .register(overlay_shortcut())
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_login_window,
            read_session_cookie,
            close_login_window,
            toggle_tree_overlay,
            set_overlay_click_through,
            tree_overlay_visible
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
