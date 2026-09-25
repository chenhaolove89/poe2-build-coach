//! Finding the game's `Client.txt` and reading it as it grows.
//!
//! This is the only *automatic* input the farming tracker has. It is strictly
//! read-only: the file is opened, seeked and read, never written or locked for
//! writing, and the game is not touched in any other way. GGG's third-party
//! policy allows reading the log (it asks that the player is told, which the UI
//! does); modifying the client or its data is what gets accounts closed, and
//! nothing here goes near that.
//!
//! Two things about the path are worth knowing before reading the code:
//!
//! - **It cannot be hardcoded.** The log lives in `<install dir>\logs\Client.txt`,
//!   next to the executable, and the install dir depends on the distributor
//!   (Steam, the Epic Games Store, GGG's own installer, WeGame on 国服). So it is
//!   discovered: first by asking the running game process where its executable
//!   is, then by checking the usual install roots, Steam's library list and
//!   Epic's manifest records.
//! - **It is written continuously while the game runs**, so reads are
//!   incremental from a remembered byte offset. A trailing fragment without a
//!   newline yet is left for the next read rather than parsed as a short line.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

/// Lines read from a file, plus where to resume next time.
#[derive(serde::Serialize)]
pub struct LogChunk {
    lines: Vec<String>,
    /// Byte offset to pass back in on the next read.
    offset: u64,
    /// Current file size, so the UI can show that it is being followed.
    size: u64,
    /// The file is smaller than the offset we were given, so it was replaced or
    /// truncated (the game was reinstalled, or the player deleted it while
    /// running). The caller has to throw away what it had and start over.
    truncated: bool,
}

/// Read everything from `offset` to the end of the file.
///
/// `expect_partial_first` is for reads that deliberately start in the middle of
/// the file: whether the first line is a fragment is then decided by the byte
/// just before `offset`, not by the offset itself. Skipping unconditionally
/// would throw away a perfectly good line whenever the read happened to land on
/// a line boundary.
fn read_at(path: &str, offset: u64, expect_partial_first: bool) -> Result<LogChunk, String> {
    let mut file = File::open(path).map_err(|e| format!("无法打开日志 {path}:{e}"))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let truncated = offset > size;
    let start = if truncated { 0 } else { offset };

    let mut partial_first = false;
    if expect_partial_first && start > 0 {
        file.seek(SeekFrom::Start(start - 1)).map_err(|e| e.to_string())?;
        let mut previous = [0u8; 1];
        if file.read(&mut previous).map_err(|e| e.to_string())? == 1 {
            partial_first = previous[0] != b'\n';
        }
    }

    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;

    // Only whole lines count. The client flushes line by line, so a tail without
    // a newline is a line still being written; parsing it now would produce a
    // mangled event and it would never be re-read.
    let complete = buf.iter().rposition(|b| *b == b'\n').map(|i| i + 1).unwrap_or(0);
    let text = String::from_utf8_lossy(&buf[..complete]);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let mut lines: Vec<String> = text.lines().map(|l| l.to_string()).collect();
    if partial_first && !lines.is_empty() {
        lines.remove(0);
    }

    Ok(LogChunk { lines, offset: start + complete as u64, size, truncated })
}

/// Read new log lines from a byte offset.
#[tauri::command]
pub fn read_log_from(path: String, offset: u64) -> Result<LogChunk, String> {
    read_at(&path, offset, false)
}

/// Read the last `bytes` of the log, without moving the caller's offset.
///
/// Used once when a session starts, to find the area the player is already
/// standing in: tailing from the end of the file would otherwise leave the
/// tracker blind until the next area change, which is a whole map away.
#[tauri::command]
pub fn read_log_tail(path: String, bytes: u64) -> Result<LogChunk, String> {
    let size = std::fs::metadata(&path).map_err(|e| format!("无法读取日志 {path}:{e}"))?.len();
    read_at(&path, size.saturating_sub(bytes), true)
}

/// Where the game keeps its log, if it can be found.
#[tauri::command]
pub fn find_client_log() -> Option<String> {
    let list = candidates();
    list.into_iter().find(|p| std::path::Path::new(p).is_file())
}

/// Candidate log paths, best first, without duplicates.
fn candidates() -> Vec<String> {
    let mut out = Vec::new();

    // The running game knows exactly where it is installed, which is the only
    // reliable answer on 国服: WeGame puts games under its own directory tree.
    for dir in process_dirs() {
        out.push(format!("{dir}\\logs\\Client.txt"));
    }

    for key in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Ok(base) = std::env::var(key) {
            out.push(format!("{base}\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt"));
        }
    }

    for root in steam_roots() {
        out.push(format!("{root}\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt"));
        for lib in steam_libraries(&format!("{root}\\steamapps\\libraryfolders.vdf")) {
            out.push(format!("{lib}\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt"));
        }
    }

    out.extend(epic_logs());

    out.extend(wegame_logs());

    // The crash logs live under Documents, so check there too in case a build
    // puts the client log alongside them.
    if let Ok(home) = std::env::var("USERPROFILE") {
        if let Ok(entries) = std::fs::read_dir(format!("{home}\\Documents\\My Games\\Path of Exile 2")) {
            for entry in entries.flatten() {
                // Only directories: the folder also holds files (crash logs),
                // and appending to those produced nonsense like `1.txt\logs\...`.
                if !entry.path().is_dir() {
                    continue;
                }
                out.push(entry.path().join("logs").join("Client.txt").to_string_lossy().to_string());
            }
        }
    }

    dedup_paths(out)
}

/// Drop repeats, case-insensitively — Windows treats `E:\steam` and `E:\Steam`
/// as one directory, and the Steam library list happily supplies both spellings
/// of paths the drive-letter guesses already produced.
fn dedup_paths(paths: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    paths.into_iter().filter(|p| seen.insert(p.to_ascii_lowercase())).collect()
}

/// Log paths inside a WeGame installation.
///
/// WeGame is how 国服 is distributed, and it names the game's folder after the
/// game's Chinese title, so guessing the folder name is hopeless. Instead the
/// known WeGame roots are listed one and two levels deep and every folder is
/// tested for a `logs\Client.txt` — the folder's name does not matter, only that
/// the log is where the executable is.
///
/// The roots are scanned across all usual drive letters, not just the system
/// drive: WeGame installs wherever it was pointed, and a real machine had it in
/// `E:\腾讯游戏\WeGame` with the games beside it — a root set pinned to `C:`
/// found nothing there once the game was closed and the process lookup with it.
fn wegame_logs() -> Vec<String> {
    let mut roots = Vec::new();
    for drive in ["C", "D", "E", "F", "G", "H"] {
        roots.push(format!("{drive}:\\WeGameApps"));
        roots.push(format!("{drive}:\\腾讯游戏"));
        roots.push(format!("{drive}:\\WeGame"));
    }
    for key in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Ok(base) = std::env::var(key) {
            roots.push(format!("{base}\\WeGame"));
            roots.push(format!("{base}\\腾讯游戏"));
        }
    }

    let mut out = Vec::new();
    for root in dedup_paths(roots) {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            out.push(entry.path().join("logs").join("Client.txt").to_string_lossy().to_string());
            // `rail_apps\<game>` is one level further down.
            if let Ok(inner) = std::fs::read_dir(entry.path()) {
                for nested in inner.flatten() {
                    if nested.path().is_dir() {
                        out.push(nested.path().join("logs").join("Client.txt").to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    out
}

/// Log paths of Epic Games Store installs.
///
/// Epic is one of the international client's storefronts, alongside Steam and
/// GGG's own installer. Its launcher records every installed game as a JSON
/// `.item` manifest under the ProgramData data dir, and the manifest's
/// `InstallLocation` is the game folder. The game is recognised by name with
/// spaces squeezed out, because the store id (`PathOfExile2`) and the display
/// name (`Path of Exile 2`) differ only in that.
fn epic_logs() -> Vec<String> {
    let base = match std::env::var("ProgramData") {
        Ok(base) => base,
        Err(_) => return Vec::new(),
    };
    epic_logs_in(&format!("{base}\\Epic\\EpicGamesLauncher\\Data\\Manifests"))
}

/// The readable half of `epic_logs`, split out so tests can feed a directory.
fn epic_logs_in(dir: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        if entry.path().extension().and_then(|e| e.to_str()) != Some("item") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let is_poe = ["DisplayName", "AppName"].iter().any(|key| {
            json.get(key)
                .and_then(|v| v.as_str())
                .map(|s| s.replace(' ', "").to_ascii_lowercase().contains("pathofexile"))
                .unwrap_or(false)
        });
        if !is_poe {
            continue;
        }
        if let Some(location) = json.get("InstallLocation").and_then(|v| v.as_str()) {
            // Some manifests store forward slashes; Windows accepts either,
            // but the mixed result reads wrong and dedup_paths would treat
            // the two spellings as different directories.
            let location = location.replace('/', "\\");
            let location = location.trim_end_matches('\\');
            if !location.is_empty() {
                out.push(format!("{location}\\logs\\Client.txt"));
            }
        }
    }
    out
}

/// Executable directories of any running Path of Exile process.
#[cfg(windows)]
fn process_dirs() -> Vec<String> {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let mut out = Vec::new();
    unsafe {
        let snapshot: HANDLE = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        // `CreateToolhelp32Snapshot` returns -1 on failure, and a null handle is
        // not a valid value either.
        if snapshot.is_null() || snapshot == -1isize as HANDLE {
            return out;
        }

        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry);
        while more != 0 {
            let name_len = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]).to_ascii_lowercase();
            // 国服 runs the same executable under WeGame's launcher, so match the
            // game name rather than a launcher name.
            if name.contains("pathofexile") {
                let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID);
                if !handle.is_null() {
                    // Long paths are possible, so ask for far more than MAX_PATH.
                    let mut buf = [0u16; 32_768];
                    let mut len = buf.len() as u32;
                    if QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len) != 0 {
                        let path = String::from_utf16_lossy(&buf[..len as usize]);
                        if let Some(dir) = std::path::Path::new(&path).parent() {
                            out.push(dir.to_string_lossy().to_string());
                        }
                    }
                    CloseHandle(handle);
                }
            }
            more = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
    }
    out
}

#[cfg(not(windows))]
fn process_dirs() -> Vec<String> {
    Vec::new()
}

/// Steam install roots worth looking in, across the usual drives.
fn steam_roots() -> Vec<String> {
    let mut roots = Vec::new();
    for key in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Ok(base) = std::env::var(key) {
            roots.push(format!("{base}\\Steam"));
        }
    }
    for drive in ["C", "D", "E", "F", "G", "H"] {
        roots.push(format!("{drive}:\\Steam"));
        roots.push(format!("{drive}:\\SteamLibrary"));
        roots.push(format!("{drive}:\\Program Files (x86)\\Steam"));
        roots.push(format!("{drive}:\\Program Files\\Steam"));
    }
    let mut seen = std::collections::HashSet::new();
    roots.retain(|root| seen.insert(root.clone()));
    roots
}

/// Library folders listed in Steam's `libraryfolders.vdf`.
///
/// Parsed by hand rather than with a VDF crate: the only thing wanted is the
/// `"path"` values, and the file is a handful of lines.
fn steam_libraries(vdf: &str) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(vdf) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let needle = b"\"path\"";
    let mut i = 0;
    while let Some(found) = text[i..].find(std::str::from_utf8(needle).unwrap()) {
        let mut j = i + found + needle.len();
        // Skip whitespace and the opening quote.
        while j < bytes.len() && (bytes[j] as char).is_whitespace() {
            j += 1;
        }
        if j >= bytes.len() || bytes[j] != b'"' {
            i = j;
            continue;
        }
        j += 1;
        let start = j;
        while j < bytes.len() && bytes[j] != b'"' {
            j += 1;
        }
        // Steam writes Windows paths with doubled backslashes.
        out.push(text[start..j].replace("\\\\", "\\"));
        i = j;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A scratch file that cleans itself up, so the tests can exercise real I/O.
    struct TempLog(std::path::PathBuf);

    impl TempLog {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("poe2coach-logtail-{name}.txt"));
            let _ = std::fs::remove_file(&path);
            TempLog(path)
        }

        fn write(&self, text: &str) {
            let mut file = File::create(&self.0).unwrap();
            file.write_all(text.as_bytes()).unwrap();
        }

        fn append(&self, text: &str) {
            let mut file = std::fs::OpenOptions::new().append(true).open(&self.0).unwrap();
            file.write_all(text.as_bytes()).unwrap();
        }

        fn path(&self) -> String {
            self.0.to_string_lossy().to_string()
        }
    }

    impl Drop for TempLog {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn steam_libraries_reads_doubled_backslash_paths() {
        // Steam escapes the separators in the VDF, so the file holds `C:\\Program`.
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\Games\"\n\t}\n}\n";
        assert_eq!(steam_libraries_of(vdf), vec!["C:\\Program Files (x86)\\Steam", "D:\\Games"]);
    }

    /// The parser only needs the text, so it is split out for testing.
    fn steam_libraries_of(text: &str) -> Vec<String> {
        let dir = std::env::temp_dir().join("poe2coach-logtail-vdf");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("libraryfolders.vdf");
        std::fs::write(&file, text).unwrap();
        let out = steam_libraries(&file.to_string_lossy());
        let _ = std::fs::remove_file(&file);
        out
    }

    #[test]
    fn epic_manifests_recognise_both_name_spellings_and_trim_the_location() {
        let dir = std::env::temp_dir().join("poe2coach-logtail-epic");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("a.item"),
            r#"{"InstallLocation": "C:\\Program Files\\Epic Games\\PathOfExile2\\", "DisplayName": "Path of Exile 2"}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("b.item"),
            r#"{"InstallLocation": "D:/Games/PoE2", "AppName": "PathOfExile2"}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("c.item"),
            r#"{"InstallLocation": "E:\\Somewhere", "DisplayName": "Some Other Game"}"#,
        )
        .unwrap();
        std::fs::write(dir.join("d.item"), "not json at all").unwrap();

        let out = epic_logs_in(&dir.to_string_lossy());
        assert_eq!(
            out,
            vec![
                "C:\\Program Files\\Epic Games\\PathOfExile2\\logs\\Client.txt",
                "D:\\Games\\PoE2\\logs\\Client.txt",
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn epic_logs_without_the_launcher_dir_are_empty_not_an_error() {
        assert!(epic_logs_in("Z:\\definitely-not-here\\Manifests").is_empty());
    }

    #[test]
    fn read_at_holds_back_a_line_that_is_still_being_written() {
        let log = TempLog::new("partial");
        log.write("2026/06/29 22:18:37 [INFO Client 1] [SCENE] Set Source [海岸]\n2026/06/29 22:18:38 [INFO Client 1] [SCE");
        let chunk = read_at(&log.path(), 0, false).unwrap();
        // The half-written line is not returned, so it cannot be mis-parsed.
        assert_eq!(chunk.lines.len(), 1);
        assert!(chunk.lines[0].contains("Set Source"));

        // Once the rest arrives it is picked up from exactly where we stopped.
        log.append("NE] Set Source [林场]\n");
        let next = read_at(&log.path(), chunk.offset, false).unwrap();
        assert_eq!(next.lines, vec!["2026/06/29 22:18:38 [INFO Client 1] [SCENE] Set Source [林场]"]);
    }

    #[test]
    fn read_at_reports_a_truncated_file_so_the_caller_can_start_over() {
        let log = TempLog::new("truncated");
        log.write("0123456789\n");
        let chunk = read_at(&log.path(), 0, false).unwrap();
        assert!(!chunk.truncated);
        assert_eq!(chunk.offset, 11);

        // The game rewrote the log from scratch, so our offset is past the end.
        log.write("new\n");
        let after = read_at(&log.path(), chunk.offset, false).unwrap();
        assert!(after.truncated);
        assert_eq!(after.offset, 4);
        assert_eq!(after.lines, vec!["new"]);
    }

    #[test]
    fn read_log_tail_drops_the_fragment_it_started_inside() {
        let log = TempLog::new("tail");
        log.write(concat!(
            "2026/06/29 22:00:00 [INFO Client 1] [SCENE] Set Source [旧区域]\n",
            "2026/06/29 22:10:00 [INFO Client 1] [SCENE] Set Source [另一个区域]\n",
            "2026/06/29 22:18:37 [INFO Client 1] [SCENE] Set Source [海岸]\n",
        ));
        let size = std::fs::metadata(log.path()).unwrap().len();
        // 70 bytes back lands inside the middle line.
        let chunk = read_log_tail(log.path(), 70).unwrap();
        assert_eq!(chunk.lines, vec!["2026/06/29 22:18:37 [INFO Client 1] [SCENE] Set Source [海岸]"]);
        assert_eq!(chunk.offset, size);
    }

    #[test]
    fn read_log_tail_keeps_the_first_line_when_it_lands_on_a_boundary() {
        let log = TempLog::new("boundary");
        log.write("2026/06/29 22:00:00 [INFO Client 1] [SCENE] Set Source [旧区域]\n2026/06/29 22:18:37 [INFO Client 1] [SCENE] Set Source [海岸]\n");
        let size = std::fs::metadata(log.path()).unwrap().len();
        // Exactly the second line, so nothing is a fragment.
        let chunk = read_log_tail(log.path(), 64).unwrap();
        assert_eq!(chunk.lines.len(), 1);
        assert!(chunk.lines[0].contains("海岸"));
        assert_eq!(chunk.offset, size);
    }

    #[test]
    fn read_log_tail_of_a_short_file_keeps_everything() {
        let log = TempLog::new("short");
        log.write("2026/06/29 22:18:37 [INFO Client 1] [SCENE] Set Source [海岸]\n");
        assert_eq!(read_log_tail(log.path(), 4096).unwrap().lines.len(), 1);
    }

    #[test]
    fn a_missing_file_is_an_error_rather_than_an_empty_read() {
        assert!(read_log_from("C:\\definitely\\not\\here\\Client.txt".into(), 0).is_err());
    }

    #[test]
    fn candidates_are_unique_and_never_point_through_a_file() {
        let list = candidates();
        assert_eq!(list.len(), dedup_paths(list.clone()).len(), "duplicate candidates");
        for path in &list {
            assert!(path.to_ascii_lowercase().ends_with("client.txt"), "{path}");
            // Every candidate must be a path to a log, not a log's parent file.
            assert_eq!(path.matches("Client.txt").count(), 1, "{path}");
        }
    }

    #[test]
    fn wegame_roots_are_guessed_from_the_drive_and_the_program_files() {
        // Not asserting a hit — the game may not be installed — only that a
        // missing root is skipped rather than panicking.
        let _ = wegame_logs();
    }
}
