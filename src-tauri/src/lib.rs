pub mod agent;
mod fluid;
mod fonts;
mod library;
mod machine;
mod native;
mod netcam;
mod packs;
mod plugin_net;
mod remote;
mod ruida_link;
mod serial_transport;
mod spell;
mod stream;
mod sync;
mod templates;
mod updater;
mod ws;

use tauri_plugin_dialog::DialogExt;

/// Speichert Text über einen nativen Speichern-Dialog. Gibt den Pfad zurück oder None bei Abbruch.
#[tauri::command]
async fn save_text_file(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    contents: String,
    directory: Option<String>,
) -> Result<Option<String>, String> {
    let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let mut dlg = app.dialog().file().set_file_name(&default_name).add_filter(&filter_name, &exts);
    if let Some(d) = directory {
        if std::path::Path::new(&d).is_dir() {
            dlg = dlg.set_directory(d);
        }
    }
    let picked = dlg.blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Schreibt Text still in eine bekannte Datei (Strg+S ohne Dialog). Fehler als Text.
#[tauri::command]
async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Öffnet eine Textdatei über einen nativen Öffnen-Dialog (startet optional im letzten Ordner).
#[tauri::command]
async fn open_text_file(
    app: tauri::AppHandle,
    filter_name: String,
    extensions: Vec<String>,
    directory: Option<String>,
) -> Result<Option<(String, String)>, String> {
    let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let mut dlg = app.dialog().file().add_filter(&filter_name, &exts);
    if let Some(d) = directory {
        if std::path::Path::new(&d).is_dir() {
            dlg = dlg.set_directory(d);
        }
    }
    let picked = dlg.blocking_pick_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some((path.display().to_string(), text)))
}

/// Datei über einen nativen Öffnen-Dialog auswählen (mehrere Filter möglich). Gibt den Pfad zurück.
#[tauri::command]
async fn pick_file(app: tauri::AppHandle, filters: Vec<(String, Vec<String>)>) -> Option<String> {
    let mut dlg = app.dialog().file();
    for (name, exts) in &filters {
        let e: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        dlg = dlg.add_filter(name, &e);
    }
    let path = dlg.blocking_pick_file()?;
    path.into_path().ok().map(|p| p.display().to_string())
}

/// Mehrere Dateien über einen nativen Öffnen-Dialog auswählen. Gibt die Pfade zurück (leer = abgebrochen).
#[tauri::command]
async fn pick_files(app: tauri::AppHandle, filters: Vec<(String, Vec<String>)>) -> Vec<String> {
    let mut dlg = app.dialog().file();
    for (name, exts) in &filters {
        let e: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        dlg = dlg.add_filter(name, &e);
    }
    dlg.blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok().map(|p| p.display().to_string()))
        .collect()
}

/// Inhalt einer Datei als Bytes (für Bilder und Importe).
#[tauri::command]
async fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// Eintrag der Ordnerliste des internen Öffnen-Dialogs (Name zur Anzeige, voller Pfad
/// zum Weitergeben; bei Dateien zusätzlich Größe und Änderungszeit für Suche/Sortierung).
#[derive(serde::Serialize)]
struct ProjectDirEntry {
    name: String,
    path: String,
    size: Option<u64>,
    modified_ms: Option<i64>,
}

/// Einstiegspunkt des Ordnerbaums: Benutzerordner, Dateisystemwurzel oder Laufwerk.
/// Die Beschriftung („Persönlicher Ordner“) vergibt die Oberfläche anhand von kind.
#[derive(serde::Serialize)]
struct ProjectRoot {
    name: String,
    path: String,
    kind: String,
}

/// Ordnerinhalt für den internen Öffnen-Dialog: tatsächlich geöffneter Ordner, Elternordner
/// (None am Stamm), Unterordner und Projektdateien, jeweils nach Name sortiert.
#[derive(serde::Serialize)]
struct ProjectDirListing {
    dir: String,
    parent: Option<String>,
    dirs: Vec<ProjectDirEntry>,
    files: Vec<ProjectDirEntry>,
    truncated: bool,
}

/// Projektdatei für den internen Öffnen-Dialog (Pfad, Name und Text).
/// Die Größe begrenzt der Aufrufer: Vorschau bis 64 MiB, ausdrückliches Öffnen bis 512 MiB.
#[derive(serde::Serialize)]
struct ProjectFileData {
    path: String,
    name: String,
    text: String,
}

/// Endungen für Liste und Lesen des internen Öffnen-Dialogs (kleingeschrieben verglichen):
/// Projekte wie im nativen Öffnen-Dialog, dazu SVG für Vorschau + Import.
fn is_project_file(name: &str) -> bool {
    match name.rsplit('.').next() {
        Some(ext) => {
            let mut lower = String::with_capacity(ext.len());
            lower.extend(ext.chars().flat_map(|c| c.to_lowercase()));
            matches!(
                lower.as_str(),
                "kzb" | "kzt" | "lwk" | "json" | "lbrn2" | "lbrn" | "svg"
            )
        }
        None => false,
    }
}

/// Ordner für den internen Öffnen-Dialog auflisten (nur Lesen, keine rekursive Suche).
/// Ohne Pfad startet die Liste im Benutzerordner. Unzugängliche Einträge werden übersprungen,
/// bei mehr als 5000 Einträgen wird der Rest abgeschnitten (truncated).
#[tauri::command]
fn project_list_dir(path: Option<String>) -> Result<ProjectDirListing, String> {
    let dir: std::path::PathBuf = match path {
        Some(p) if !p.trim().is_empty() => std::path::PathBuf::from(p.trim()),
        _ => dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/")),
    };
    if !dir.is_dir() {
        return Err(format!("Kein Ordner: {}", dir.display()));
    }
    let parent = dir
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.display().to_string());
    const LIMIT: usize = 5000;
    let mut dirs: Vec<ProjectDirEntry> = Vec::new();
    let mut files: Vec<ProjectDirEntry> = Vec::new();
    let mut truncated = false;
    let mut count = 0usize;
    let mut entries: Vec<(String, std::path::PathBuf, bool)> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let Ok(ft) = entry.file_type() else { continue };
        // Nur normale Einträge: keine Geräte, FIFOs oder andere Spezialdateien
        if !ft.is_dir() && !ft.is_file() && !ft.is_symlink() {
            continue;
        }
        let p = entry.path();
        // Defekte Symlinks und unzugängliche Ziele überspringen, statt den Dialog zu blockieren
        if ft.is_symlink() {
            match std::fs::metadata(&p) {
                Ok(md) => {
                    if !md.is_dir() && !md.is_file() {
                        continue;
                    }
                }
                Err(_) => continue,
            }
        }
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            // Dateinamen, die sich nicht verlustfrei darstellen lassen, nicht stillschweigend umbenennen
            None => continue,
        };
        // Versteckte Dateien bleiben sichtbar, damit nichts unbemerkt fehlt; sortiert wird weiter unten
        let is_dir = ft.is_dir() || (ft.is_symlink() && p.is_dir());
        if !is_dir && !is_project_file(&name) {
            continue;
        }
        entries.push((name, p, is_dir));
    }
    entries.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    for (name, p, is_dir) in entries {
        if count >= LIMIT {
            truncated = true;
            break;
        }
        count += 1;
        // Größe und Änderungszeit nur bei Dateien (für Suche/Sortierung in der Dateiliste)
        let (size, modified_ms) = if is_dir {
            (None, None)
        } else {
            match std::fs::metadata(&p) {
                Ok(md) => (
                    Some(md.len()),
                    md.modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as i64),
                ),
                Err(_) => (None, None),
            }
        };
        let e = ProjectDirEntry {
            name,
            path: p.display().to_string(),
            size,
            modified_ms,
        };
        if is_dir {
            dirs.push(e);
        } else {
            files.push(e);
        }
    }
    Ok(ProjectDirListing {
        dir: dir.display().to_string(),
        parent,
        dirs,
        files,
        truncated,
    })
}

/// Projektdatei als Text für Vorschau und Öffnen lesen (nur reguläre Projektdateien).
/// full=false begrenzt auf 64 MiB (Vorschau), full=true auf 512 MiB (ausdrückliches Öffnen).
#[tauri::command]
fn project_read_file(path: String, full: bool) -> Result<ProjectFileData, String> {
    let p = std::path::Path::new(&path);
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Ungültiger Dateiname".to_string())?
        .to_string();
    if !is_project_file(&name) {
        return Err(format!("Keine Projektdatei: {name}"));
    }
    let md = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if !md.is_file() {
        return Err(format!("Keine reguläre Datei: {name}"));
    }
    const PREVIEW_MAX: u64 = 64 * 1024 * 1024;
    const OPEN_MAX: u64 = 512 * 1024 * 1024;
    let max = if full { OPEN_MAX } else { PREVIEW_MAX };
    if md.len() > max {
        return Err(format!(
            "Datei zu groß (über {} MiB): {name}",
            max / (1024 * 1024)
        ));
    }
    let text = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
    Ok(ProjectFileData {
        path: p.display().to_string(),
        name,
        text,
    })
}

/// Ein Standard- oder Datenträger-Ort für die Orte-Leiste des internen Öffnen-Dialogs.
/// Die Beschriftung („Bilder“, „Dokumente“, …) vergibt die Oberfläche anhand von kind;
/// bei Datenträgern steht der Name schon fest.
#[derive(serde::Serialize)]
struct ProjectPlace {
    name: String,
    path: String,
    kind: String,
}

/// Standard- und Datenträger-Orte im Dolphin-Sinn: vorhandene XDG-Verzeichnisse
/// (Bilder, Dokumente, Downloads, Musik, Videos) plus eingehängte Datenträger.
/// Fehlt ein Ordner, fehlt er auch in der Liste.
#[tauri::command]
fn project_places() -> Vec<ProjectPlace> {
    let mut out = Vec::new();
    let mut push_dir = |dir: Option<std::path::PathBuf>, kind: &str| {
        if let Some(d) = dir {
            if d.is_dir() {
                let name = d
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| d.display().to_string());
                out.push(ProjectPlace {
                    name,
                    path: d.display().to_string(),
                    kind: kind.to_string(),
                });
            }
        }
    };
    push_dir(dirs::picture_dir(), "pictures");
    push_dir(dirs::document_dir(), "documents");
    push_dir(dirs::download_dir(), "downloads");
    push_dir(dirs::audio_dir(), "music");
    push_dir(dirs::video_dir(), "videos");
    // Eingehängte Datenträger: echte Einhängungen aus mountinfo (USB-Sticks,
    // zusätzliche Partitionen, NFS/CIFS/SSHFS an beliebigem Punkt). Pseudodateisysteme
    // (proc, sysfs, tmpfs, cgroup, overlay, snap, …) und „/“ (Baumwurzel) raus.
    // Ist mountinfo unlesbar, gilt die alte Heuristik über die üblichen Einhängepunkte.
    #[cfg(target_os = "linux")]
    {
        if !push_real_mounts(&mut out) {
            if let Ok(user) = std::env::var("USER") {
                for base in [format!("/media/{user}"), format!("/run/media/{user}")] {
                    push_mounts(&base, &mut out);
                }
            }
            push_mounts("/mnt", &mut out);
        }
    }
    #[cfg(target_os = "macos")]
    {
        push_mounts("/Volumes", &mut out);
    }
    out
}

/// Echte Einhängungen aus /proc/self/mountinfo als Datenträger-Orte aufnehmen.
/// Liefert false, wenn mountinfo fehlt oder nichts Brauchbares enthält (Fallback nötig).
/// Format je Zeile: … Einhängepunkt (Feld 5, Leerzeichen als \040) … „-“ fstype Quelle …
#[cfg(target_os = "linux")]
fn push_real_mounts(out: &mut Vec<ProjectPlace>) -> bool {
    const PSEUDO: &[&str] = &[
        "proc",
        "sysfs",
        "tmpfs",
        "devtmpfs",
        "devpts",
        "cgroup",
        "cgroup2",
        "pstore",
        "bpf",
        "tracefs",
        "debugfs",
        "securityfs",
        "configfs",
        "fusectl",
        "mqueue",
        "shm",
        "hugetlbfs",
        "overlay",
        "squashfs",
        "ramfs",
        "autofs",
        "binfmt_misc",
        "efivarfs",
    ];
    let Ok(text) = std::fs::read_to_string("/proc/self/mountinfo") else {
        return false;
    };
    let mut found = false;
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let mut fields = Vec::with_capacity(12);
        for _ in 0..6 {
            match parts.next() {
                Some(f) => fields.push(f),
                None => break,
            }
        }
        if fields.len() < 6 {
            continue;
        }
        // Nach dem Bindestrich steht der Dateisystemtyp
        let mut fstype = "";
        let mut dash_seen = false;
        for f in parts {
            if dash_seen {
                fstype = f;
                break;
            }
            if f == "-" {
                dash_seen = true;
            }
        }
        if !dash_seen || PSEUDO.contains(&fstype) {
            continue;
        }
        let mount: String = fields[4]
            .replace("\\040", " ")
            .replace("\\011", "\t")
            .replace("\\012", "\n")
            .replace("\\134", "\\");
        if mount == "/" || out.iter().any(|p: &ProjectPlace| p.path == mount) {
            continue;
        }
        let path = std::path::Path::new(&mount);
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.to_string())
            .unwrap_or_else(|| mount.clone());
        out.push(ProjectPlace {
            name,
            path: mount,
            kind: "device".to_string(),
        });
        found = true;
    }
    found
}
/// Fallback-Heuristik: vorhandene Unterordner eines Einhängepunkts als Datenträger aufnehmen.
fn push_mounts(base: &str, out: &mut Vec<ProjectPlace>) {
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                out.push(ProjectPlace {
                    name: name.to_string(),
                    path: p.display().to_string(),
                    kind: "device".to_string(),
                });
            }
        }
    }
}
/// Einstiegspunkte des Ordnerbaums für den internen Öffnen-Dialog:
/// Benutzerordner zuerst, danach die Dateisystemwurzel (Unix) bzw. alle
/// vorhandenen Laufwerke (Windows).
#[tauri::command]
fn project_roots() -> Vec<ProjectRoot> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        let name = home
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.to_string())
            .unwrap_or_else(|| home.display().to_string());
        roots.push(ProjectRoot {
            name,
            path: home.display().to_string(),
            kind: "home".to_string(),
        });
    }
    #[cfg(target_os = "windows")]
    {
        for c in b'A'..=b'Z' {
            let drive = format!("{}:\\", c as char);
            if std::path::Path::new(&drive).is_dir()
                && !roots.iter().any(|r: &ProjectRoot| r.path == drive)
            {
                roots.push(ProjectRoot {
                    name: drive.clone(),
                    path: drive,
                    kind: "drive".to_string(),
                });
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if !roots.iter().any(|r: &ProjectRoot| r.path == "/") {
            roots.push(ProjectRoot {
                name: "/".to_string(),
                path: "/".to_string(),
                kind: "root".to_string(),
            });
        }
    }
    roots
}

/// Speichert Binärdaten (Base64) über einen nativen Speichern-Dialog.
#[tauri::command]
async fn save_binary_file(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    base64: String,
) -> Result<Option<String>, String> {
    let data = decode_base64(&base64).ok_or("Ungültige Daten")?;
    let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &exts)
        .blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

pub(crate) fn decode_base64(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let bytes: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut acc = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            acc |= val(c)? << (18 - 6 * i);
        }
        let n = chunk.len();
        if n < 2 {
            return None;
        }
        out.push((acc >> 16) as u8);
        if n > 2 {
            out.push((acc >> 8) as u8);
        }
        if n > 3 {
            out.push(acc as u8);
        }
    }
    Some(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Kamera für das Kamerabild auf der Arbeitsfläche ohne zusätzliche Rückfrage der Webansicht freigeben;
        // die Freigabe des Betriebssystems (macOS: Datenschutz › Kamera) bleibt davon unberührt.
        .on_permission_request(|_, kind| match kind {
            tauri::webview::PermissionKind::Camera => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Default,
        })
        .manage(machine::Machine::default())
        .manage(agent::Agent::default())
        .manage(netcam::NetCams::default())
        .manage(remote::Remote::default())
        .manage(updater::Pending::default())
        .manage(std::sync::Arc::new(native::Native::default()))
        .setup(|app| {
            use tauri::Manager;
            // Wry ties IsPinchZoomEnabled to zoom_hotkeys_enabled (false by
            // default). Enable precision-touchpad pinch independently so the
            // canvas can consume Ctrl+wheel. Browser zoom hotkeys stay disabled.
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| {
                    use windows_core::Interface;
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
                    let result = (|| -> windows_core::Result<()> {
                        unsafe {
                            let settings = webview.controller().CoreWebView2()?.Settings()?;
                            settings.cast::<ICoreWebView2Settings5>()?.SetIsPinchZoomEnabled(true)
                        }
                    })();
                    if let Err(error) = result {
                        eprintln!("Touchpad pinch could not be enabled: {error}");
                    }
                })?;
            }

            agent::start(app.handle(), &app.state::<agent::Agent>());
            remote::start(app.handle(), &app.state::<remote::Remote>());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            netcam::netcam_open,
            netcam::netcam_frame,
            netcam::netcam_close,
            save_text_file,
            write_text_file,
            open_text_file,
            project_list_dir,
            project_read_file,
            project_roots,
            project_places,
            pick_file,
            pick_files,
            read_file,
            save_binary_file,
            plugin_net::plugin_fetch,
            fonts::list_fonts,
            fonts::font_data,
            fonts::font_installed,
            fonts::font_catalog,
            fonts::font_install_google,
            fonts::font_import,
            fonts::font_remove,
            fonts::font_open_folder,
            spell::spell_list_installed,
            spell::spell_download,
            spell::spell_remove,
            spell::spell_check_words,
            spell::spell_suggest,
            machine::machine_ports,
            machine::machine_connect,
            machine::machine_disconnect,
            machine::machine_send,
            machine::machine_realtime,
            machine::machine_job,
            machine::machine_ruida_job,
            machine::machine_job_prepared,
            native::image_register,
            native::image_process,
            native::image_scan,
            native::gcode_prepare,
            native::gcode_save,
            native::ruida_prepare,
            native::ruida_save,
            machine::machine_pause,
            machine::machine_resume,
            machine::machine_stop,
            fluid::fluid_upload,
            fluid::fluid_discover,
            agent::agent_info,
            agent::agent_configure,
            agent::agent_new_token,
            agent::agent_respond,
            agent::agent_write_file,
            agent::agent_machine_log,
            remote::remote_host_info,
            remote::remote_host_configure,
            remote::remote_host_clients,
            remote::remote_host_client_role,
            remote::remote_host_client_remove,
            remote::remote_pairing_role,
            remote::remote_pairing_cancel,
            remote::remote_respond,
            remote::remote_host_state,
            remote::remote_host_broadcast,
            remote::remote_connect,
            remote::remote_disconnect,
            remote::remote_request,
            remote::remote_pair_begin,
            remote::remote_pair_finish,
            remote::remote_pair_cancel,
            remote::remote_paired,
            remote::remote_discover,
            remote::remote_forget,
            templates::template_list,
            templates::template_read,
            templates::template_write,
            templates::template_delete,
            templates::template_open_folder,
            packs::pack_list,
            packs::pack_write,
            packs::pack_delete,
            packs::pack_open_folder,
            library::library_list,
            library::library_read,
            library::library_write,
            library::library_delete,
            library::library_open_folder,
            sync::sync_pick_folder,
            sync::sync_machine_name,
            sync::sync_list,
            sync::sync_read,
            sync::sync_write,
            sync::sync_open_folder,
            sync::sync_dir_stat,
            sync::sync_dir_read,
            sync::sync_dir_write,
            sync::sync_dir_delete,
            updater::update_supported,
            updater::update_check,
            updater::update_install
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Start der Anwendung");
}
