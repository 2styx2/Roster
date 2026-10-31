use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;

fn main() {
    // tauri-build embeds the icons (the exe's resource and the window icon), but doesn't tell Cargo
    // to rebuild when they change, so a new icon.ico kept the old icon in every later build. Watch
    // the folder, and pass a hash of its contents to the crate so generate_context! compiles again.
    let dir = Path::new("icons");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .expect("icons/")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file())
        .collect();
    files.sort();
    let mut hasher = DefaultHasher::new();
    for f in &files {
        println!("cargo:rerun-if-changed={}", f.display());
        f.file_name().hash(&mut hasher);
        std::fs::read(f).expect("icon file").hash(&mut hasher);
    }
    println!("cargo:rustc-env=ROSTER_APP_ICONS_HASH={:x}", hasher.finish());
    tauri_build::build()
}
