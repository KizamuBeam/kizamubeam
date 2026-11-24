//! Mehrsprachige Rechtschreibprüfung mit nachladbaren Hunspell-Wörterbüchern (UTF-8, wooorm/dictionaries).
//! Wörterbücher liegen im Einstellungsordner der App unter `dictionaries/<code>/` (`index.aff`, `index.dic`,
//! `license`) und werden im Speicher gehalten, solange die App läuft.

use spellbook::Dictionary;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::Duration;

/// Maximale Größe einzelner Wörterbuchdateien (Schutz vor fehlerhaften/übergroßen Antworten)
const MAX_AFF_BYTES: usize = 10 * 1024 * 1024;
const MAX_DIC_BYTES: usize = 30 * 1024 * 1024;
const MAX_LICENSE_BYTES: usize = 1024 * 1024;
const DICT_BASE_URL: &str = "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries";

/// Zugelassene Sprachkennungen im Katalog (UTF-8-Hunspell-Wörterbücher in wooorm/dictionaries).
/// Nur diese Kennungen dürfen geladen, gelesen oder gelöscht werden (kein Pfad-Zugriff von außen).
const ALLOWED_CODES: &[&str] = &[
    "bg", "ca", "cs", "da", "de", "de-AT", "de-CH", "el", "en", "en-AU", "en-CA", "en-GB", "es",
    "et", "fr", "hr", "hu", "it", "lt", "lv", "nb", "nl", "nn", "pl", "pt", "pt-PT", "ro", "ru",
    "sk", "sl", "sv", "tr", "uk", "vi",
];

pub fn is_allowed_code(code: &str) -> bool {
    ALLOWED_CODES.contains(&code)
}

fn cache() -> MutexGuard<'static, HashMap<String, Arc<Dictionary>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Arc<Dictionary>>>> = OnceLock::new();
    CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

fn dict_root() -> Result<PathBuf, String> {
    let d = dirs::config_dir()
        .ok_or("Kein Ordner für Einstellungen")?
        .join(crate::agent::APP_ID)
        .join("dictionaries");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn dict_dir(code: &str) -> Result<PathBuf, String> {
    if !is_allowed_code(code) {
        return Err(format!("Unbekannte Wörterbuch-Sprache: {code}"));
    }
    Ok(dict_root()?.join(code))
}

fn client() -> Result<reqwest::Client, String> {
    static INIT: OnceLock<()> = OnceLock::new();
    INIT.get_or_init(|| {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
    });
    reqwest::Client::builder()
        .user_agent(concat!("KizamuBeam/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_utf8(url: &str, max: usize) -> Result<String, String> {
    let res = client()?.get(url).send().await.map_err(|e| format!("{url}: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("{url}: HTTP {}", status.as_u16()));
    }
    if res.content_length().is_some_and(|n| n as usize > max) {
        return Err(format!("{url}: Datei zu groß"));
    }
    let body = res.bytes().await.map_err(|e| format!("{url}: {e}"))?;
    if body.len() > max {
        return Err(format!("{url}: Datei zu groß"));
    }
    String::from_utf8(body.to_vec()).map_err(|_| format!("{url}: ungültiges UTF-8"))
}

/// Lädt ein installiertes Wörterbuch aus dem Cache oder von Platte. Fehlt es auf Platte, liefert Ok(None).
fn load_installed(code: &str) -> Result<Option<Arc<Dictionary>>, String> {
    if !is_allowed_code(code) {
        return Ok(None);
    }
    if let Some(d) = cache().get(code).cloned() {
        return Ok(Some(d));
    }
    let dir = dict_dir(code)?;
    let aff_path = dir.join("index.aff");
    let dic_path = dir.join("index.dic");
    if !aff_path.is_file() || !dic_path.is_file() {
        return Ok(None);
    }
    let aff = std::fs::read_to_string(&aff_path).map_err(|e| format!("{code}: {e}"))?;
    let dic = std::fs::read_to_string(&dic_path).map_err(|e| format!("{code}: {e}"))?;
    let dict = Arc::new(
        Dictionary::new(&aff, &dic)
            .map_err(|e| format!("Wörterbuch {code} konnte nicht gelesen werden: {e}"))?,
    );
    cache().insert(code.to_string(), Arc::clone(&dict));
    Ok(Some(dict))
}

fn load_many(langs: &[String]) -> Result<Vec<Arc<Dictionary>>, String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for code in langs {
        if !seen.insert(code.as_str()) {
            continue;
        }
        if let Some(d) = load_installed(code)? {
            out.push(d);
        }
    }
    Ok(out)
}

fn check_words_with_dicts(dicts: &[Arc<Dictionary>], words: &[String]) -> Vec<String> {
    if dicts.is_empty() {
        return Vec::new();
    }
    let mut seen = HashSet::new();
    let mut bad = Vec::new();
    for w in words {
        if w.is_empty() || !seen.insert(w.as_str()) {
            continue;
        }
        let ok = dicts.iter().any(|d| d.check(w));
        if !ok {
            bad.push(w.clone());
        }
    }
    bad
}

fn suggest_with_dicts(dicts: &[Arc<Dictionary>], word: &str, limit: usize) -> Vec<String> {
    if dicts.is_empty() || word.is_empty() || limit == 0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut buf = Vec::new();
    for d in dicts {
        d.suggest(word, &mut buf);
        for s in &buf {
            if seen.insert(s.clone()) {
                out.push(s.clone());
                if out.len() >= limit {
                    return out;
                }
            }
        }
    }
    out
}

/// Liste der lokal installierten Wörterbuch-Codes (sortiert).
#[tauri::command]
pub async fn spell_list_installed() -> Result<Vec<String>, String> {
    let root = dict_root()?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(root).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_allowed_code(&name) {
            continue;
        }
        let p = entry.path();
        if p.join("index.aff").is_file() && p.join("index.dic").is_file() {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}

/// Lädt ein Wörterbuch (index.aff, index.dic, license) aus dem Katalog, prüft es und speichert es lokal.
#[tauri::command]
pub async fn spell_download(code: String) -> Result<(), String> {
    if !is_allowed_code(&code) {
        return Err(format!("Unbekannte Wörterbuch-Sprache: {code}"));
    }
    let base = format!("{DICT_BASE_URL}/{code}");
    let aff = fetch_utf8(&format!("{base}/index.aff"), MAX_AFF_BYTES).await?;
    let dic = fetch_utf8(&format!("{base}/index.dic"), MAX_DIC_BYTES).await?;
    let license = fetch_utf8(&format!("{base}/license"), MAX_LICENSE_BYTES)
        .await
        .unwrap_or_default();

    let code_for_parse = code.clone();
    let aff_for_parse = aff.clone();
    let dic_for_parse = dic.clone();
    let parsed = tauri::async_runtime::spawn_blocking(move || {
        Dictionary::new(&aff_for_parse, &dic_for_parse)
            .map(Arc::new)
            .map_err(|e| format!("Wörterbuch {code_for_parse} ist ungültig: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;

    let dir = dict_dir(&code)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("index.aff"), aff.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("index.dic"), dic.as_bytes()).map_err(|e| e.to_string())?;
    if !license.is_empty() {
        let _ = std::fs::write(dir.join("license"), license.as_bytes());
    }
    cache().insert(code, parsed);
    Ok(())
}

/// Entfernt ein installiertes Wörterbuch aus Cache und Einstellungsordner.
#[tauri::command]
pub async fn spell_remove(code: String) -> Result<(), String> {
    let dir = dict_dir(&code)?;
    cache().remove(&code);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Prüft eine Liste von Wörtern gegen alle angegebenen installierten Sprachen und liefert nur die fehlerhaften zurück.
#[tauri::command]
pub async fn spell_check_words(langs: Vec<String>, words: Vec<String>) -> Result<Vec<String>, String> {
    if langs.is_empty() || words.is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dicts = load_many(&langs)?;
        Ok(check_words_with_dicts(&dicts, &words))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Korrekturvorschläge für ein einzelnes Wort über alle angegebenen installierten Sprachen.
#[tauri::command]
pub async fn spell_suggest(
    langs: Vec<String>,
    word: String,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let cap = limit.unwrap_or(6).clamp(1, 15);
    if langs.is_empty() || word.is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dicts = load_many(&langs)?;
        Ok(suggest_with_dicts(&dicts, &word, cap))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_de() -> Arc<Dictionary> {
        let aff = "SET UTF-8\nTRY esianrtolcdugmphbyfvkwäöüß\n";
        let dic = "5\nHolz\nLaser\nGravur\nWerkstatt\nSchneidebrett\n";
        Arc::new(Dictionary::new(aff, dic).expect("de fixture"))
    }

    fn sample_en() -> Arc<Dictionary> {
        let aff = "SET UTF-8\nTRY esianrtolcdugmphbyfvkw\n";
        let dic = "4\nwood\nlaser\nengraving\nworkshop\n";
        Arc::new(Dictionary::new(aff, dic).expect("en fixture"))
    }

    #[test]
    fn allowlist_rejects_traversal_and_unknown() {
        assert!(is_allowed_code("de"));
        assert!(is_allowed_code("de-AT"));
        assert!(is_allowed_code("en-GB"));
        assert!(is_allowed_code("pt-PT"));
        assert!(!is_allowed_code("../de"));
        assert!(!is_allowed_code("de/en"));
        assert!(!is_allowed_code("xx-FAKE"));
        assert!(!is_allowed_code(""));
    }

    #[test]
    fn multi_language_check_accepts_words_from_any_active_dict() {
        let dicts = vec![sample_de(), sample_en()];
        let words: Vec<String> = vec!["Holz", "workshop", "Werkstat", "Gravur", "lasr", "Werkstat"]
            .into_iter()
            .map(String::from)
            .collect();
        let bad = check_words_with_dicts(&dicts, &words);
        assert_eq!(bad, vec!["Werkstat", "lasr"]);
    }

    #[test]
    fn empty_dicts_report_no_errors() {
        let words = vec!["Werkstat".to_string()];
        assert!(check_words_with_dicts(&[], &words).is_empty());
    }

    #[test]
    fn suggest_returns_corrections_across_dicts_and_respects_limit() {
        let dicts = vec![sample_de(), sample_en()];
        let de_sugg = suggest_with_dicts(&dicts, "Werkstat", 5);
        assert!(de_sugg.iter().any(|s| s == "Werkstatt"), "got {de_sugg:?}");

        let en_sugg = suggest_with_dicts(&dicts, "workshpo", 2);
        assert!(en_sugg.len() <= 2);
        assert!(en_sugg.iter().any(|s| s == "workshop"), "got {en_sugg:?}");
    }
}
