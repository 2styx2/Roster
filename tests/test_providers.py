import os
import shutil

import pytest

from roster import providers
from roster.providers import SecretError, get_secret, setup_providers


def cfg_with(isolated, providers_conf=None, dirs=None):
    return {"path": isolated["work"] / "roster.yml", "providers": providers_conf or {}, "provider_dirs": dirs or []}


def test_env_provider(monkeypatch):
    monkeypatch.setenv("SW_PW", "s3cret")
    assert get_secret("env:SW_PW", "g") == "s3cret"
    with pytest.raises(SecretError, match="not set"):
        get_secret("env:NOPE_NOT_SET", "g")


def test_cmd_provider_and_no_password_sources():
    assert get_secret("cmd:printf 'abc\\n'", "g") == "abc"
    assert get_secret("agent", "g") is None
    assert get_secret(None, "g") is None
    with pytest.raises(SecretError, match="exit 3"):
        get_secret("cmd:exit 3", "g")


def test_unknown_provider_lists_what_exists():
    with pytest.raises(SecretError, match="unknown password source 'keeper'.*bw.*op"):
        get_secret("keeper:x", "g")


def test_prompt_without_terminal_fails_cleanly():
    with pytest.raises(SecretError, match="no terminal"):
        get_secret("prompt", "g")


def test_template_provider(isolated):
    setup_providers(cfg_with(isolated, {"kv": {"command": "printf '%s' secret-{item}-{field}",
                                               "default_field": "password"}}))
    assert get_secret("kv:infra/web", "g") == "secret-infra/web-password"
    assert get_secret("kv:infra/web#token", "g") == "secret-infra/web-token"
    assert providers.PROVIDERS["kv"]["kind"] == "roster.yml"


def test_template_provider_quotes_input(isolated):
    setup_providers(cfg_with(isolated, {"echo": {"command": "printf '%s' {item}"}}))
    assert get_secret("echo:a b; rm -rf /tmp/nothing", "g") == "a b; rm -rf /tmp/nothing"


def test_bad_template_is_reported(isolated):
    setup_providers(cfg_with(isolated, {"bad": {"command": "echo {nope}"}}))
    with pytest.raises(SecretError, match="bad command template"):
        get_secret("bad:x", "g")


def test_plugin_from_providers_folder(isolated, fakes):
    from conftest import EXAMPLES
    plugdir = isolated["work"] / "providers"
    plugdir.mkdir()
    shutil.copy(EXAMPLES / "providers" / "pass_store.py", plugdir)
    setup_providers(cfg_with(isolated))
    assert providers.PROVIDERS["pass"]["kind"] == "plugin"
    assert get_secret("pass:infra/orion", "g") == "pw-deploy"
    assert get_secret("pass:infra/orion#dbadmin", "g") == "pw-dbadmin"
    with pytest.raises(SecretError, match="not in the password store"):
        get_secret("pass:infra/missing", "g")


def test_plugin_in_user_config_dir(isolated, fakes):
    from conftest import EXAMPLES
    plugdir = isolated["home"] / ".config" / "roster" / "providers"
    plugdir.mkdir(parents=True)
    shutil.copy(EXAMPLES / "providers" / "pass_store.py", plugdir)
    setup_providers(cfg_with(isolated))
    assert "pass" in providers.PROVIDERS


def test_broken_plugin_warns_but_does_not_crash(isolated, capsys):
    plugdir = isolated["work"] / "providers"
    plugdir.mkdir()
    (plugdir / "broken.py").write_text("this is not python\n")
    (plugdir / "_skipped.py").write_text("raise SystemExit('should never load')\n")
    setup_providers(cfg_with(isolated))
    assert "broken.py didn't load" in capsys.readouterr().out


def test_crashing_plugin_becomes_secret_error(isolated):
    plugdir = isolated["work"] / "providers"
    plugdir.mkdir()
    (plugdir / "crashy.py").write_text("@register('crashy')\ndef get(spec, ctx):\n    return 1 / 0\n")
    setup_providers(cfg_with(isolated))
    with pytest.raises(SecretError, match="ZeroDivisionError"):
        get_secret("crashy:x", "g")


# ---- Bitwarden (fake bw: logged in, locked, master password "hunter2")

def test_bitwarden_unlock_password_and_fields(fakes, monkeypatch):
    monkeypatch.setenv("BW_PASSWORD", "hunter2")
    assert get_secret("bw:Orion servers", "g") == "pw-deploy"
    assert get_secret("bw:Orion servers#dbadmin", "g") == "pw-dbadmin"
    assert get_secret("bw:Orion servers#username", "g") == "deploy"
    assert get_secret("bw:Network gear", "g") == "pw-netops"     # two fuzzy matches, one exact name


def test_bitwarden_errors(fakes, monkeypatch):
    with pytest.raises(SecretError, match="locked and there's no terminal"):
        get_secret("bw:Orion servers", "g")
    monkeypatch.setenv("BW_PASSWORD", "wrong")
    with pytest.raises(SecretError, match="unlock failed"):
        get_secret("bw:Orion servers", "g")
    providers.PROVIDER_STATE.clear()
    monkeypatch.setenv("BW_PASSWORD", "hunter2")
    with pytest.raises(SecretError, match="no Bitwarden item matches 'Nope'"):
        get_secret("bw:Nope", "g")
    with pytest.raises(SecretError, match="has no password set"):
        get_secret("bw:Empty one", "g")
    with pytest.raises(SecretError, match="has no field 'missing'"):
        get_secret("bw:Orion servers#missing", "g")


def test_bitwarden_existing_session_needs_no_password(fakes, monkeypatch):
    monkeypatch.setenv("BW_SESSION", "fake-session-key")
    assert get_secret("bw:Network gear", "g") == "pw-netops"


# ---- unlock / lock without a terminal (what `roster serve` calls)

def test_unlock_with_master_password_needs_no_terminal_or_session_file(isolated, fakes):
    providers.unlock("bw", "hunter2")
    assert get_secret("bw:Network gear", "g") == "pw-netops"
    assert not (isolated["home"] / ".config" / "roster" / "bw-session").exists()


def test_unlock_with_wrong_master_password_says_so_without_echoing_it(fakes):
    with pytest.raises(SecretError, match="wrong master password") as e:
        providers.unlock("bw", "not-the-password-xyzzy")
    assert "xyzzy" not in str(e.value)
    with pytest.raises(SecretError, match="locked"):
        get_secret("bw:Network gear", "g")


def test_lock_forgets_session_cache_and_state_and_runs_bw_lock(fakes, monkeypatch, tmp_path):
    log = tmp_path / "calls.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    providers.unlock("bw", "hunter2")
    assert get_secret("bw:Network gear", "g") == "pw-netops"
    providers.lock("bw")
    assert "BW_SESSION" not in os.environ
    assert "bw lock" in log.read_text().splitlines()
    with pytest.raises(SecretError, match="locked"):           # cached value and "ready" are gone too
        get_secret("bw:Network gear", "g")


def test_vault_status_tells_missing_cli_from_logged_out(fakes, monkeypatch, tmp_path):
    assert providers.vault_status("bw") == "locked"
    providers.unlock("bw", "hunter2")
    assert providers.vault_status("bw") == "unlocked"
    providers.lock("bw")
    monkeypatch.setenv("FAKE_BW_LOGGED_OUT", "1")
    assert providers.vault_status("bw") == "unauthenticated"
    with pytest.raises(SecretError, match="isn't logged in"):
        providers.unlock("bw", "hunter2")
    monkeypatch.setenv("PATH", str(tmp_path))                  # no bw anywhere
    assert providers.vault_status("bw") == "missing"
    with pytest.raises(SecretError, match="not installed"):
        providers.unlock("bw", "hunter2")


def test_providers_without_unlock_degrade(monkeypatch):
    assert providers.vault_status("env") == "unsupported"
    with pytest.raises(SecretError, match="can't be unlocked"):
        providers.unlock("env", "x")
    monkeypatch.setenv("SOME_PW", "s3cret")
    assert get_secret("env:SOME_PW", "g") == "s3cret"
    providers.lock("env")                                       # still forgets cached values
    monkeypatch.setenv("SOME_PW", "changed")
    assert get_secret("env:SOME_PW", "g") == "changed"
    with pytest.raises(SecretError, match="unknown password source"):
        providers.lock("keeper")


# ---- 1Password (fake op: signed out until signin; items live in vault "Infra")

def test_onepassword_items_and_references(isolated, fakes):
    setup_providers(cfg_with(isolated, {"op": {"vault": "Infra"}}))
    assert get_secret("op:Network gear", "g") == "pw-netops"
    assert get_secret("op:Network gear#enable", "g") == "en-secret"
    assert get_secret("op:Infra/Orion servers", "g") == "pw-deploy"
    assert get_secret("op:op://Infra/Network gear/enable", "g") == "en-secret"
    with pytest.raises(SecretError, match="isn't an item"):
        get_secret("op:Nope", "g")


def test_onepassword_old_cli_without_reveal(isolated, fakes, monkeypatch):
    monkeypatch.setenv("OLD_OP", "1")
    setup_providers(cfg_with(isolated, {"op": {"vault": "Infra"}}))
    assert get_secret("op:Network gear", "g") == "pw-netops"


def test_onepassword_service_account_skips_signin(isolated, fakes, monkeypatch):
    monkeypatch.setenv("OP_SERVICE_ACCOUNT_TOKEN", "ops_test")
    assert get_secret("op:op://Infra/Orion servers/password", "g") == "pw-deploy"


def test_secret_values_are_cached_per_run(monkeypatch, tmp_path):
    counter = tmp_path / "n"
    ref = f"cmd:echo x >> {counter}; printf v"
    assert get_secret(ref, "a") == "v"
    assert get_secret(ref, "b") == "v"
    assert counter.read_text().count("x") == 1


def _session_file(isolated, text, mode=0o600):
    f = isolated["home"] / ".config" / "roster" / "bw-session"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text)
    f.chmod(mode)
    return f


def test_bw_session_file_unlocks_without_terminal(isolated, fakes):
    _session_file(isolated, "fake-session-key\n")
    assert get_secret("bw:Network gear", "g") == "pw-netops"


def test_bw_session_file_readable_by_others_is_ignored(isolated, fakes, capsys):
    _session_file(isolated, "fake-session-key\n", mode=0o644)
    with pytest.raises(SecretError, match="locked"):
        get_secret("bw:Network gear", "g")
    assert "readable by others" in capsys.readouterr().out


def test_bw_expired_session_file_says_refresh(isolated, fakes):
    _session_file(isolated, "stale-key\n")
    with pytest.raises(SecretError, match="has expired.*bw unlock --raw >"):
        get_secret("bw:Network gear", "g")
