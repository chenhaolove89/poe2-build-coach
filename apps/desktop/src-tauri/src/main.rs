// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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

/// Hot keys to show and hide the overlay, tried in order until one registers.
///
/// A bare F8 was the first choice and it is already taken on at least one
/// machine — something else on Windows had it — so a list is tried instead and
/// the winner reported to the UI. Modifier combinations lead because plain
/// function keys are the ones other software claims.
///
/// Whichever wins, the hotkey reads nothing from the game: the player presses
/// it, gets a reference version of their tree, and presses it again. Nothing is
/// drawn unless asked for, and no game state is involved on either side.
fn hotkey_candidates() -> Vec<Shortcut> {
    vec![
        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyQ),
        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyT),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyT),
        Shortcut::new(None, Code::F8),
        Shortcut::new(None, Code::F9),
        Shortcut::new(None, Code::F10),
    ]
}

/// Whichever candidate registered, or `None` when every one of them was taken.
///
/// Held as state rather than a constant because which one wins is only known at
/// startup, and the UI has to show the player the key that actually works.
struct OverlayHotkey(Mutex<Option<Shortcut>>);

fn hotkey_label(shortcut: &Shortcut) -> String {
    shortcut.clone().into_string()
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

/// Size of the overlay card, in logical pixels.
const OVERLAY_SIZE: (f64, f64) = (560.0, 470.0);

/// Where the overlay first appears: top-right, clear of the game's own HUD.
///
/// A card rather than a full screen. It used to cover the whole monitor so it
/// could be lined up with the game's tree, and that could not work: the app
/// cannot know how the game has panned or zoomed its tree, so the two never
/// matched. Showing only the region the selection sits in needs no lining up —
/// it is a reference the player parks somewhere and reads.
fn overlay_origin(app: &AppHandle) -> (f64, f64) {
    let margin = 24.0;
    match app.primary_monitor() {
        Ok(Some(monitor)) => {
            let scale = monitor.scale_factor();
            let logical_width = monitor.size().width as f64 / scale;
            ((logical_width - OVERLAY_SIZE.0 - margin).max(margin), margin)
        }
        _ => (margin, margin),
    }
}

/// Show or hide the tree overlay, creating it on first use.
///
/// Returns whether it is now visible. The window is borderless and always on
/// top, and it *accepts* clicks by default so the player can drag it where they
/// want it; `set_overlay_click_through` locks it out of the way once placed.
/// Dragging is impossible while clicks pass through, which is why it does not
/// start locked.
///
/// It never takes focus unless asked, because stealing it would drop the game
/// out of the foreground. This is a reference the player summons, not something
/// that follows the game: the app never learns anything about the game's state,
/// so nothing here can drift or interfere.
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

    let (x, y) = overlay_origin(&app);
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
    .resizable(true)
    .position(x, y)
    .inner_size(OVERLAY_SIZE.0, OVERLAY_SIZE.1)
    .build()
    .map_err(|e| e.to_string())?;

    window.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Lock the overlay out of the way, or unlock it so it can be dragged.
///
/// While locked it ignores every click, so play continues underneath; while
/// unlocked it can be moved and resized.
#[tauri::command]
async fn set_overlay_click_through(app: AppHandle, click_through: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| "overlay is not open".to_string())?;
    window
        .set_ignore_cursor_events(click_through)
        .map_err(|e| e.to_string())
}

/// The key that actually shows and hides the overlay, or `None` if every
/// candidate was taken — the UI falls back to its own button then.
#[tauri::command]
fn overlay_hotkey(state: tauri::State<'_, OverlayHotkey>) -> Option<String> {
    state.0.lock().ok()?.as_ref().map(hotkey_label)
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
            // Registering a hotkey must never be fatal. It was, briefly: a bare
            // F8 that another program already owned made the whole app refuse to
            // start, which is a far worse failure than a hotkey that does not
            // work. Take the first candidate that registers and otherwise carry
            // on — the overlay is still reachable from the UI.
            let mut chosen = None;
            for candidate in hotkey_candidates() {
                match app.global_shortcut().register(candidate.clone()) {
                    Ok(()) => {
                        chosen = Some(candidate);
                        break;
                    }
                    Err(err) => eprintln!("hotkey {candidate:?} unavailable: {err}"),
                }
            }
            if chosen.is_none() {
                eprintln!("no overlay hotkey could be registered; use the in-app button");
            }
            app.manage(OverlayHotkey(Mutex::new(chosen)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_login_window,
            read_session_cookie,
            close_login_window,
            toggle_tree_overlay,
            set_overlay_click_through,
            tree_overlay_visible,
            overlay_hotkey
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
