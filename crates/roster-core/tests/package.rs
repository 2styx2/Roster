//! Packages (ticket 24, decision Q83): Plugins from git repos, pinned in `roster.lock`. The
//! sources here are local bare repos in a temp dir, so nothing touches the network.

use roster_core::config::{self, PackageSpec};
use roster_core::package::{Packages, check_specs, name_of, url_of};
use roster_core::plugin::{Limits, PluginHost, Serve, Source};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

fn temp(test: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("roster-core-package-{}-{test}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "-c",
            "commit.gpgsign=false",
        ])
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git runs");
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// A Plugin's source: a bare repo (the "remote") and a work tree that pushes to it.
struct Repo {
    bare: PathBuf,
    work: PathBuf,
}

fn manifest(version: &str, permissions: &[&str]) -> String {
    let list: Vec<String> = permissions.iter().map(|p| format!("{p:?}")).collect();
    format!(
        "return {{ name = \"recent-alerts\", version = {version:?}, description = \"Alerts\", author = \"A. Author\", api = 2, permissions = {{ {} }} }}\n",
        list.join(", ")
    )
}

impl Repo {
    fn new(root: &Path) -> Repo {
        let bare = root.join("remote").join("recent-alerts.git");
        let work = root.join("work");
        std::fs::create_dir_all(&bare).unwrap();
        std::fs::create_dir_all(&work).unwrap();
        git(&bare, &["init", "--quiet", "--bare", "--initial-branch=main"]);
        git(&work, &["init", "--quiet", "--initial-branch=main"]);
        git(&work, &["remote", "add", "origin", bare.to_str().unwrap()]);
        let repo = Repo { bare, work };
        repo.commit(
            "1.0.0",
            &["terminal.read"],
            "roster.commands.add(\"alerts\", { run = \"close\" })\n",
            "first",
        );
        repo
    }

    /// Commits a version and pushes it; gives its id.
    fn commit(&self, version: &str, permissions: &[&str], init: &str, message: &str) -> String {
        std::fs::write(self.work.join("roster-plugin.lua"), manifest(version, permissions)).unwrap();
        std::fs::write(self.work.join("init.lua"), init).unwrap();
        git(&self.work, &["add", "."]);
        git(&self.work, &["commit", "--quiet", "-m", message]);
        git(&self.work, &["push", "--quiet", "origin", "main"]);
        git(&self.work, &["rev-parse", "HEAD"])
    }

    fn tag(&self, tag: &str) {
        git(&self.work, &["tag", tag]);
        git(&self.work, &["push", "--quiet", "origin", tag]);
    }

    fn url(&self) -> String {
        self.bare.to_str().unwrap().to_string()
    }
}

fn spec(source: &str) -> PackageSpec {
    PackageSpec {
        source: source.into(),
        name: None,
        tag: None,
        branch: None,
        commit: None,
        config: Default::default(),
    }
}

fn lock_json(config: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(config.join("roster.lock")).unwrap()).unwrap()
}

#[test]
fn installing_clones_into_the_data_dir_and_pins_the_commit_once_allowed() {
    let root = temp("install");
    let repo = Repo::new(&root);
    let (data, config) = (root.join("data"), root.join("config"));
    let packages = Packages::new(&data, &config);
    let specs = vec![spec(&repo.url())];

    let status = packages.sync(&specs);
    assert_eq!(status.len(), 1);
    let s = &status[0];
    assert_eq!(s.error, None);
    assert_eq!(s.name, "recent-alerts");
    let head = git(&repo.work, &["rev-parse", "HEAD"]);
    assert_eq!(s.commit.as_deref(), Some(head.as_str()));
    // Not installed until the user says so: no lock yet.
    assert!(!s.pinned);
    assert!(!config.join("roster.lock").exists());
    assert!(data.join("packages/recent-alerts/roster-plugin.lua").exists());

    let pinned = packages.pin(&specs, "recent-alerts").unwrap();
    assert!(pinned.pinned);
    assert_eq!(
        lock_json(&config),
        json!({ "recent-alerts": { "source": repo.url(), "commit": head } })
    );
    assert!(packages.sync(&specs)[0].pinned);
}

#[test]
fn cancelling_the_install_leaves_nothing_behind() {
    let root = temp("cancel");
    let repo = Repo::new(&root);
    let (data, config) = (root.join("data"), root.join("config"));
    let packages = Packages::new(&data, &config);
    packages.sync(&[spec(&repo.url())]);
    packages.discard("recent-alerts").unwrap();
    assert!(!data.join("packages/recent-alerts").exists());
    assert!(!config.join("roster.lock").exists());
    assert!(packages.discard("../config").is_err());
}

#[test]
fn reinstalling_from_the_lock_gives_the_same_commit_and_a_tag_is_honoured() {
    let root = temp("relock");
    let repo = Repo::new(&root);
    repo.tag("v1.0.0");
    let first = git(&repo.work, &["rev-parse", "HEAD"]);
    let config = root.join("config");
    let mut s = spec(&repo.url());
    s.tag = Some("v1.0.0".into());
    let specs = vec![s];
    let packages = Packages::new(&root.join("data"), &config);
    packages.sync(&specs);
    packages.pin(&specs, "recent-alerts").unwrap();
    assert_eq!(lock_json(&config)["recent-alerts"]["tag"], "v1.0.0");

    // The repo moves on; a new Box with the same dotfiles (the lock) gets the pinned commit.
    repo.commit("1.1.0", &["terminal.read"], "-- newer\n", "second");
    let other = Packages::new(&root.join("other-data"), &config);
    let status = other.sync(&specs);
    assert_eq!(status[0].commit.as_deref(), Some(first.as_str()));
    assert!(status[0].pinned);
}

#[test]
fn starting_offline_works_from_the_lock_and_the_clones() {
    let root = temp("offline");
    let repo = Repo::new(&root);
    let packages = Packages::new(&root.join("data"), &root.join("config"));
    let specs = vec![spec(&repo.url())];
    packages.sync(&specs);
    packages.pin(&specs, "recent-alerts").unwrap();
    // The source is gone (no network, say).
    std::fs::rename(&repo.bare, root.join("moved")).unwrap();
    let status = packages.sync(&specs);
    assert_eq!(status[0].error, None);
    assert!(status[0].pinned);
}

#[test]
fn update_shows_the_diff_and_new_commit_and_changes_nothing_until_applied() {
    let root = temp("update");
    let repo = Repo::new(&root);
    let (data, config) = (root.join("data"), root.join("config"));
    let packages = Packages::new(&data, &config);
    let specs = vec![spec(&repo.url())];
    packages.sync(&specs);
    packages.pin(&specs, "recent-alerts").unwrap();
    let old = git(&repo.work, &["rev-parse", "HEAD"]);
    assert!(packages.check(&specs)[0].update.is_none(), "up to date");

    let new = repo.commit(
        "2.0.0",
        &["terminal.read", "terminal.write"],
        "roster.commands.add(\"alerts\", { run = \"close\" })\n-- now types too\n",
        "Type into Sessions",
    );
    let checked = packages.check(&specs);
    let update = checked[0].update.as_ref().expect("an update");
    assert_eq!(update.from, old);
    assert_eq!(update.to, new);
    assert_eq!(update.log.len(), 1);
    assert!(update.log[0].ends_with("Type into Sessions"));
    assert!(update.diff.contains("+-- now types too"));
    assert!(update.stat.contains("init.lua"));
    let m = update.manifest.as_ref().unwrap();
    assert_eq!(m.version, "2.0.0");
    assert_eq!(m.permissions.len(), 2);

    // Declining: nothing moved, the lock is as it was.
    assert_eq!(packages.sync(&specs)[0].commit.as_deref(), Some(old.as_str()));
    assert_eq!(lock_json(&config)["recent-alerts"]["commit"], old.as_str());

    // Allowing: moved and pinned.
    let status = packages.apply(&specs, "recent-alerts", &new).unwrap();
    assert_eq!(status.commit.as_deref(), Some(new.as_str()));
    assert_eq!(lock_json(&config)["recent-alerts"]["commit"], new.as_str());
    let text = std::fs::read_to_string(data.join("packages/recent-alerts/init.lua")).unwrap();
    assert!(text.contains("now types too"));
}

#[test]
fn clean_removes_packages_init_lua_no_longer_names() {
    let root = temp("clean");
    let repo = Repo::new(&root);
    let (data, config) = (root.join("data"), root.join("config"));
    let packages = Packages::new(&data, &config);
    let specs = vec![spec(&repo.url())];
    packages.sync(&specs);
    packages.pin(&specs, "recent-alerts").unwrap();
    assert_eq!(packages.clean(&specs).unwrap(), Vec::<String>::new());
    assert_eq!(packages.clean(&[]).unwrap(), vec!["recent-alerts".to_string()]);
    assert!(!data.join("packages/recent-alerts").exists());
    assert_eq!(lock_json(&config), json!({}));
}

#[test]
fn nothing_installs_that_init_lua_doesnt_name() {
    let root = temp("unnamed");
    let repo = Repo::new(&root);
    let packages = Packages::new(&root.join("data"), &root.join("config"));
    packages.sync(&[spec(&repo.url())]);
    for err in [
        packages.pin(&[], "recent-alerts").unwrap_err(),
        packages.loadable(&[], "recent-alerts").unwrap_err(),
        packages
            .apply(&[], "recent-alerts", &git(&repo.work, &["rev-parse", "HEAD"]))
            .unwrap_err(),
    ] {
        assert!(err.contains("init.lua names no Package recent-alerts"), "{err}");
    }
    assert!(packages.loadable(&[spec(&repo.url())], "recent-alerts").is_ok());
}

#[test]
fn a_source_that_cant_be_fetched_is_an_error_not_a_half_clone() {
    let root = temp("missing");
    let packages = Packages::new(&root.join("data"), &root.join("config"));
    let status = packages.sync(&[spec(root.join("nowhere.git").to_str().unwrap())]);
    assert!(status[0].error.as_deref().unwrap().contains("can't fetch"));
    let left: Vec<_> = std::fs::read_dir(root.join("data/packages")).unwrap().collect();
    assert!(left.is_empty());
}

#[test]
fn sources_are_owner_repo_or_a_safe_git_url() {
    assert_eq!(
        url_of("someone/recent-alerts").unwrap(),
        "https://github.com/someone/recent-alerts.git"
    );
    for ok in [
        "https://git.example.com/a/b.git",
        "ssh://git@git.example.com/a/b.git",
        "git@git.example.com:a/b.git",
        "file:///srv/git/b.git",
        "/srv/git/b.git",
        "C:\\git\\b.git",
    ] {
        assert_eq!(url_of(ok).unwrap(), ok);
    }
    for bad in [
        "http://git.example.com/a.git",
        "git://git.example.com/a.git",
        "ext::sh -c touch% /tmp/x",
        "-upload-pack=x",
        "a/b/c",
        "",
    ] {
        assert!(url_of(bad).is_err(), "{bad}");
    }
    assert_eq!(
        name_of(&spec("git@git.example.com:a/recent-alerts.git")).unwrap(),
        "recent-alerts"
    );
    let mut named = spec("a/b");
    named.name = Some("alerts".into());
    assert_eq!(name_of(&named).unwrap(), "alerts");
}

#[test]
fn init_lua_declares_packages_the_lazy_nvim_way() {
    let dir = temp("config");
    let source = r#"
        return {
          packages = {
            { "someone/recent-alerts", tag = "v1.0.0", config = { patterns = { "ERROR" } } },
            "someone/pinned",
          },
        }"#;
    let c = config::load_source(&dir, source, &config::Env::default()).unwrap();
    assert_eq!(c.packages.len(), 2);
    assert_eq!(c.packages[0].source, "someone/recent-alerts");
    assert_eq!(c.packages[0].tag.as_deref(), Some("v1.0.0"));
    assert_eq!(c.packages[0].config["patterns"], json!(["ERROR"]));
    assert_eq!(c.packages[1].source, "someone/pinned");

    let e = config::load_source(
        &dir,
        "return { packages = { { \"a/b\", config = function() end } } }",
        &config::Env::default(),
    )
    .unwrap_err();
    assert!(e.message.contains("packages.1.config"), "{}", e.message);
    assert!(e.message.contains("not a function"), "{}", e.message);
    let e = config::load_source(
        &dir,
        "return { packages = { \"a/b\", \"c/b\" } }",
        &config::Env::default(),
    )
    .unwrap_err();
    assert!(e.message.contains("named b too"), "{}", e.message);
    let e = config::load_source(
        &dir,
        "return { packages = { { \"a/b\", tag = \"v1\", branch = \"main\" } } }",
        &config::Env::default(),
    )
    .unwrap_err();
    assert!(e.message.contains("one of tag, branch or commit"), "{}", e.message);
    assert!(check_specs(&[spec("http://x.example.com/a.git")]).is_err());
}

struct NoServe;
impl Serve for NoServe {
    fn call(&self, method: &str, _: Value) -> Result<Value, String> {
        Err(format!("no {method}"))
    }
}

#[test]
fn a_package_loads_as_a_plugin_with_its_settings_from_init_lua() {
    let root = temp("load");
    let repo = Repo::new(&root);
    repo.commit(
        "1.0.0",
        &[],
        "local roster = require(\"roster\")\nroster.status.set(\"alerts\", { text = roster.plugin.config.label or \"none\" })\n",
        "use the config",
    );
    let packages = Packages::new(&root.join("data"), &root.join("config"));
    let mut s = spec(&repo.url());
    s.config.insert("label".into(), json!("⚠ 0"));
    let specs = vec![s];
    packages.sync(&specs);
    let (dir, config) = packages.loadable(&specs, "recent-alerts").unwrap();
    let host = PluginHost::new(Arc::new(NoServe), Limits::default());
    let (manifest, reply) = host.load_with(&Source::Dir(dir), &[], &config).unwrap();
    assert_eq!(manifest.name, "recent-alerts");
    assert_eq!(reply.error, None);
    assert_eq!(reply.ops[0]["spec"]["text"], "⚠ 0");
}
