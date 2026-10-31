//! `folders.yml` next to `init.lua` (decision Q46): the Folders made in the app, as plain data
//! both the app and the user edit. The core only reads and writes the text, atomically; the
//! frontend parses it (src/folders/file.ts), and the watcher (watch.rs) says when it changed.

use super::watch::FOLDERS_FILE;
use std::path::{Path, PathBuf};

/// A Folders file bigger than this is a mistake, not something to read into the window.
pub const MAX_BYTES: usize = 1024 * 1024;

pub fn path(dir: &Path) -> PathBuf {
    dir.join(FOLDERS_FILE)
}

/// The file's text, or None when there's none yet.
pub fn read(dir: &Path) -> std::io::Result<Option<String>> {
    match std::fs::read(path(dir)) {
        Ok(bytes) if bytes.len() > MAX_BYTES => Err(std::io::Error::other(format!(
            "{FOLDERS_FILE} is {} bytes (at most {MAX_BYTES})",
            bytes.len()
        ))),
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| std::io::Error::other(format!("{FOLDERS_FILE} isn't UTF-8 text"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Replaces the file with `text`, all at once (a temporary file beside it, then a rename), so
/// an editor or the watcher never sees half of it.
pub fn write(dir: &Path, text: &str) -> std::io::Result<()> {
    if text.len() > MAX_BYTES {
        return Err(std::io::Error::other(format!(
            "the Folders are {} bytes (at most {MAX_BYTES})",
            text.len()
        )));
    }
    super::write_atomic(&path(dir), text)
}
