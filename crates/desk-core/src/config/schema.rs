//! The Config's schema: what `init.lua` may return, with every default. Lua names are
//! snake_case (`bold_weight`); the object sent to the frontend is camelCase (`boldWeight`) and
//! mirrors `src/config/types.ts`. Unknown names are errors, so a typo is reported with its line
//! instead of silently doing nothing.
//!
//! Several options take a shorthand as well as a table (`sidebar = false`, `statusbar = true`,
//! `ansi = false`); the custom Deserialize impls below normalize them, so the frontend always
//! gets one shape.

use serde::de::{self, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

/// The whole Config: built-in defaults with `init.lua`'s values layered over them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all(serialize = "camelCase"))]
pub struct Config {
    /// A Theme's id, or "auto" to follow the OS with `dark_theme` / `light_theme`.
    pub theme: String,
    pub dark_theme: String,
    pub light_theme: String,
    /// New Themes (or changed copies of bundled ones), by id.
    pub themes: BTreeMap<String, ThemeDef>,
    /// Colour tokens set over whichever Theme is in use.
    pub colors: ThemeColors,
    /// The UI's fonts (decision Q30).
    pub fonts: Fonts,
    pub terminal: Terminal,
    /// The chord that takes the keyboard back from a terminal.
    pub leader: String,
    pub vim: bool,
    pub idle_lock_minutes: u32,
    /// The view mode at start: "standard" or "focus" (decision Q36).
    pub default_mode: ViewMode,
    /// Open Sessions listed in the Sidebar, or in a tab strip.
    pub sessions: SessionsIn,
    /// Key bindings: in Lua, per context, key or sequence → action (a command line), or false
    /// to unbind. Sent as a list.
    pub keys: Keys,
    /// The layout of each view mode (decision Q39).
    pub modes: Modes,
    /// Personal Folders (GLOSSARY: Folder) defined here; read-only in the app.
    #[serde(deserialize_with = "list")]
    pub folders: Vec<FolderDef>,
    /// The command that runs roster (development). The `ROSTER_DESK_ROSTER` env var wins.
    pub roster_command: Option<RosterCommand>,
    /// "auto", "local", "wsl" or "wsl:<distro>". `ROSTER_DESK_WSL_DISTRO` wins.
    pub backend: BackendChoice,
    /// Where each value came from in the file, for warnings the frontend raises (an unknown
    /// command in `keys`). Filled in after the schema check; never read from Lua.
    #[serde(skip_deserializing)]
    pub lines: BTreeMap<String, Location>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            theme: "auto".into(),
            dark_theme: "roster-dark".into(),
            light_theme: "roster-light".into(),
            themes: BTreeMap::new(),
            colors: ThemeColors::default(),
            fonts: Fonts::default(),
            terminal: Terminal::default(),
            leader: "Ctrl+Space".into(),
            vim: true,
            idle_lock_minutes: 15,
            default_mode: ViewMode::Standard,
            sessions: SessionsIn::Sidebar,
            keys: Keys::default(),
            modes: Modes::default(),
            folders: Vec::new(),
            roster_command: None,
            backend: BackendChoice::Auto,
            lines: BTreeMap::new(),
        }
    }
}

/// A place in a Lua file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Location {
    /// Relative to the config dir, `/`-separated: `init.lua`, `lua/keys.lua`.
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Fonts {
    /// A family name ("Inter") or a whole CSS font stack (anything with a comma).
    pub ui: String,
    /// The wordmark's and code-like UI text's font.
    pub mono: String,
}

impl Default for Fonts {
    fn default() -> Self {
        Fonts {
            ui: "Inter".into(),
            mono: "Iosevka".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all(serialize = "camelCase"))]
pub struct Terminal {
    /// A family name ("Iosevka") or a whole CSS font stack.
    pub font: String,
    /// Points; zoom keys move it, `Ctrl+0` comes back here.
    pub size: u32,
    /// 100–900. Medium (500) by default; the bundled Iosevka has 400, 500 and 700.
    pub weight: u32,
    pub bold_weight: u32,
    pub line_height: f64,
    pub scrollback: u32,
    pub copy_on_select: bool,
    /// Right-click copies the selection, or pastes when nothing is selected.
    pub right_click_paste: bool,
    /// Terminal colours over the Theme's: background, cursor, the 16 ANSI colours…
    pub colors: TerminalColors,
}

impl Default for Terminal {
    fn default() -> Self {
        Terminal {
            font: "Iosevka".into(),
            size: 14,
            weight: 500,
            bold_weight: 700,
            line_height: 1.0,
            scrollback: 10_000,
            copy_on_select: true,
            right_click_paste: true,
            colors: TerminalColors::default(),
        }
    }
}

/// Declares a struct of optional colour strings, skipped when unset, unknown names refused.
macro_rules! colors {
    ($(#[$doc:meta])* $name:ident { $($field:ident),* $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
        #[serde(default, deny_unknown_fields, rename_all(serialize = "camelCase"))]
        pub struct $name {
            $(
                #[serde(skip_serializing_if = "Option::is_none")]
                pub $field: Option<String>,
            )*
        }

        impl $name {
            /// The Lua names, in order.
            pub const NAMES: &'static [&'static str] = &[$(stringify!($field)),*];
        }
    };
}

colors!(
    /// The UI's colour tokens (src/theme/theme.ts ThemeColors).
    ThemeColors {
        accent, accent_text, accent_ink, bg, chrome, sidebar, panel, raised, raised_line, hover,
        line, line_strong, text, muted, faint, warn, error, danger, danger_text, backdrop, shadow,
    }
);

colors!(
    /// A Theme's own terminal colours, apart from the 16 ANSI ones.
    ThemeTerminalColors {
        background, foreground, cursor, cursor_accent, selection_background, search_match,
        search_active_match,
    }
);

colors!(
    /// The 16 ANSI colours; any left out keep the standard palette's (decision Q37).
    Ansi {
        black, red, green, yellow, blue, magenta, cyan, white, bright_black, bright_red,
        bright_green, bright_yellow, bright_blue, bright_magenta, bright_cyan, bright_white,
    }
);

colors!(
    /// `terminal.colors`: any terminal colour, the ANSI ones included.
    TerminalColors {
        background, foreground, cursor, cursor_accent, selection_background, search_match,
        search_active_match, black, red, green, yellow, blue, magenta, cyan, white, bright_black,
        bright_red, bright_green, bright_yellow, bright_blue, bright_magenta, bright_cyan,
        bright_white,
    }
);

/// A Theme defined in `init.lua`: a bundled one (`base`) with tokens changed, or a new one.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ThemeDef {
    /// Shown in the app; the id if left out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// "dark" or "light": which OS appearance it suits. The base's if left out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<Appearance>,
    /// The Theme it starts from: every token it doesn't set comes from there. Defaults to
    /// Roster dark or Roster light, by `appearance`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    pub colors: ThemeColors,
    pub terminal: ThemeTerminalColors,
    /// The terminal's 16 colours; `false` keeps the standard palette even if the base has its
    /// own. Left out: the base's.
    pub ansi: AnsiChoice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    Dark,
    Light,
}

/// `ansi = { … }`, `ansi = false`, or nothing.
#[derive(Debug, Clone, Default, PartialEq)]
pub enum AnsiChoice {
    #[default]
    Inherit,
    Standard,
    Colors(Box<Ansi>),
}

impl Serialize for AnsiChoice {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            AnsiChoice::Inherit => s.serialize_str("inherit"),
            AnsiChoice::Standard => s.serialize_str("standard"),
            AnsiChoice::Colors(a) => a.serialize(s),
        }
    }
}

impl<'de> Deserialize<'de> for AnsiChoice {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = AnsiChoice;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a table of ANSI colours, or false for the standard palette")
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<AnsiChoice, E> {
                if v {
                    Err(E::custom(
                        "ansi = true means nothing: give a table of colours, or false",
                    ))
                } else {
                    Ok(AnsiChoice::Standard)
                }
            }
            fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<AnsiChoice, A::Error> {
                Ansi::deserialize(de::value::MapAccessDeserializer::new(map)).map(|a| AnsiChoice::Colors(Box::new(a)))
            }
        }
        d.deserialize_any(V)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    Standard,
    Focus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionsIn {
    Sidebar,
    Tabs,
}

/// The keymap's contexts (src/keymap.ts Keymap).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyContext {
    /// After the Leader (App mode).
    Leader,
    /// Moving in a list (the Sidebar), always.
    List,
    /// Moving in a list when vim keys are on.
    ListVim,
    /// In the Picker.
    Picker,
    /// In the Picker's list when vim keys are on.
    PickerVim,
    /// In a terminal, before the shell sees the key.
    Terminal,
    /// Everywhere, with no Leader (F11).
    Global,
}

impl KeyContext {
    pub const ALL: [KeyContext; 7] = [
        KeyContext::Leader,
        KeyContext::List,
        KeyContext::ListVim,
        KeyContext::Picker,
        KeyContext::PickerVim,
        KeyContext::Terminal,
        KeyContext::Global,
    ];

    /// The name in Lua.
    pub fn lua_name(self) -> &'static str {
        match self {
            KeyContext::Leader => "leader",
            KeyContext::List => "list",
            KeyContext::ListVim => "list_vim",
            KeyContext::Picker => "picker",
            KeyContext::PickerVim => "picker_vim",
            KeyContext::Terminal => "terminal",
            KeyContext::Global => "global",
        }
    }
}

/// One key binding from the Config.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KeyBinding {
    pub context: KeyContext,
    /// A chord or a sequence: "x", "Ctrl+n", "g g".
    pub keys: String,
    pub action: KeyAction,
}

/// The Config's key bindings, in context order, then key order.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(from = "KeysPatch")]
pub struct Keys(pub Vec<KeyBinding>);

impl Serialize for Keys {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(s)
    }
}

type KeyTable = Option<BTreeMap<String, KeyAction>>;

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct KeysPatch {
    leader: KeyTable,
    list: KeyTable,
    list_vim: KeyTable,
    picker: KeyTable,
    picker_vim: KeyTable,
    terminal: KeyTable,
    global: KeyTable,
}

impl From<KeysPatch> for Keys {
    fn from(p: KeysPatch) -> Self {
        let tables = [
            p.leader,
            p.list,
            p.list_vim,
            p.picker,
            p.picker_vim,
            p.terminal,
            p.global,
        ];
        let mut out = Vec::new();
        for (context, table) in KeyContext::ALL.into_iter().zip(tables) {
            for (keys, action) in table.unwrap_or_default() {
                out.push(KeyBinding { context, keys, action });
            }
        }
        Keys(out)
    }
}

/// What a key does: an action (a command line such as "session 1"), or nothing (`false`
/// unbinds a default). Serialized as the string, or null.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyAction {
    Run(String),
    Unbind,
}

impl Serialize for KeyAction {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            KeyAction::Run(a) => s.serialize_str(a),
            KeyAction::Unbind => s.serialize_none(),
        }
    }
}

impl<'de> Deserialize<'de> for KeyAction {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl Visitor<'_> for V {
            type Value = KeyAction;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("an action name (a command line such as \"session 1\"), or false to unbind the key")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<KeyAction, E> {
                if v.trim().is_empty() {
                    return Err(E::custom("an empty action: use false to unbind a key"));
                }
                Ok(KeyAction::Run(v.trim().to_string()))
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<KeyAction, E> {
                if v {
                    Err(E::custom(
                        "a key can be an action name, or false to unbind it (not true)",
                    ))
                } else {
                    Ok(KeyAction::Unbind)
                }
            }
        }
        d.deserialize_any(V)
    }
}

/// Each view mode's layout (decision Q39). The pieces: title bar, Sidebar (and its sections),
/// session bar, status bar (and its segments).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(from = "ModesPatch")]
pub struct Modes {
    pub standard: ModeLayout,
    pub focus: ModeLayout,
}

impl Default for Modes {
    fn default() -> Self {
        Modes {
            standard: ModeLayout {
                fullscreen: false,
                titlebar: true,
                sidebar: SidebarPiece {
                    shown: true,
                    side: Side::Left,
                    sections: None,
                },
                sessionbar: SessionBarPiece {
                    shown: false,
                    at: Edge::Bottom,
                },
                statusbar: StatusBarPiece {
                    shown: true,
                    segments: None,
                },
            },
            focus: ModeLayout {
                fullscreen: true,
                titlebar: false,
                sidebar: SidebarPiece {
                    shown: false,
                    side: Side::Left,
                    sections: None,
                },
                sessionbar: SessionBarPiece {
                    shown: false,
                    at: Edge::Bottom,
                },
                statusbar: StatusBarPiece {
                    shown: false,
                    segments: None,
                },
            },
        }
    }
}

/// One mode's layout, as sent to the frontend: every piece, shown or not.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModeLayout {
    /// OS fullscreen (Focus by default).
    pub fullscreen: bool,
    pub titlebar: bool,
    pub sidebar: SidebarPiece,
    pub sessionbar: SessionBarPiece,
    pub statusbar: StatusBarPiece,
}

/// What `init.lua` says about the modes: only what it sets, laid over each mode's defaults.
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct ModesPatch {
    standard: ModePatch,
    focus: ModePatch,
}

/// One mode in Lua. Each piece takes a shorthand: `sidebar = false`, `sessionbar = "bottom"`,
/// `statusbar = { "backend", "hosts" }`. A piece left out keeps the mode's default.
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct ModePatch {
    fullscreen: Option<bool>,
    titlebar: Option<bool>,
    sidebar: Option<SidebarPiece>,
    sessionbar: Option<SessionBarPiece>,
    statusbar: Option<StatusBarPiece>,
}

impl ModePatch {
    fn over(self, base: ModeLayout) -> ModeLayout {
        ModeLayout {
            fullscreen: self.fullscreen.unwrap_or(base.fullscreen),
            titlebar: self.titlebar.unwrap_or(base.titlebar),
            sidebar: self.sidebar.unwrap_or(base.sidebar),
            sessionbar: self.sessionbar.unwrap_or(base.sessionbar),
            statusbar: self.statusbar.unwrap_or(base.statusbar),
        }
    }
}

impl From<ModesPatch> for Modes {
    fn from(p: ModesPatch) -> Self {
        let d = Modes::default();
        Modes {
            standard: p.standard.over(d.standard),
            focus: p.focus.over(d.focus),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    #[default]
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Edge {
    Top,
    Bottom,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SidebarPiece {
    pub shown: bool,
    pub side: Side,
    /// Section ids in order ("sessions", "folders", "inventory"); null: all, in their order.
    pub sections: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SidebarTable {
    #[serde(default)]
    side: Option<Side>,
    #[serde(default, deserialize_with = "opt_list")]
    sections: Option<Vec<String>>,
}

impl<'de> Deserialize<'de> for SidebarPiece {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = SidebarPiece;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("true, false, or a table { side = \"left\" | \"right\", sections = { … } }")
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<SidebarPiece, E> {
                Ok(SidebarPiece {
                    shown: v,
                    ..SidebarPiece::default()
                })
            }
            fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<SidebarPiece, A::Error> {
                let t = SidebarTable::deserialize(de::value::MapAccessDeserializer::new(map))?;
                Ok(SidebarPiece {
                    shown: true,
                    side: t.side.unwrap_or_default(),
                    sections: t.sections,
                })
            }
        }
        d.deserialize_any(V)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SessionBarPiece {
    pub shown: bool,
    pub at: Edge,
}

impl Default for SessionBarPiece {
    fn default() -> Self {
        SessionBarPiece {
            shown: false,
            at: Edge::Bottom,
        }
    }
}

impl<'de> Deserialize<'de> for SessionBarPiece {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl Visitor<'_> for V {
            type Value = SessionBarPiece;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("\"bottom\", \"top\" or false")
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<SessionBarPiece, E> {
                Ok(SessionBarPiece {
                    shown: v,
                    at: Edge::Bottom,
                })
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<SessionBarPiece, E> {
                let at = match v {
                    "top" => Edge::Top,
                    "bottom" => Edge::Bottom,
                    _ => return Err(E::invalid_value(de::Unexpected::Str(v), &self)),
                };
                Ok(SessionBarPiece { shown: true, at })
            }
        }
        d.deserialize_any(V)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct StatusBarPiece {
    pub shown: bool,
    /// Segment ids in order ("backend", "box", "hosts", "path", "hints", "mode"); null: all.
    pub segments: Option<Vec<String>>,
}

impl<'de> Deserialize<'de> for StatusBarPiece {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = StatusBarPiece;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("true, false, or a list of segments such as { \"backend\", \"hosts\" }")
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<StatusBarPiece, E> {
                Ok(StatusBarPiece {
                    shown: v,
                    segments: None,
                })
            }
            fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<StatusBarPiece, A::Error> {
                let segments = ListVisitor::<String>::new().visit_seq(seq)?;
                Ok(StatusBarPiece {
                    shown: true,
                    segments: Some(segments),
                })
            }
            fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<StatusBarPiece, A::Error> {
                let segments = ListVisitor::<String>::new().visit_map(map)?;
                Ok(StatusBarPiece {
                    shown: true,
                    segments: Some(segments),
                })
            }
        }
        d.deserialize_any(V)
    }
}

/// A Folder defined in `init.lua`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FolderDef {
    pub name: String,
    #[serde(default, deserialize_with = "list")]
    pub hosts: Vec<String>,
}

/// `roster_command = "uv run --project ~/work/roster roster"` (split on spaces) or a list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct RosterCommand(pub Vec<String>);

impl<'de> Deserialize<'de> for RosterCommand {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = RosterCommand;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a command line (split on spaces) or a list of words")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<RosterCommand, E> {
                let words: Vec<String> = v.split_whitespace().map(String::from).collect();
                if words.is_empty() {
                    return Err(E::custom("an empty roster_command"));
                }
                Ok(RosterCommand(words))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<RosterCommand, A::Error> {
                let words = ListVisitor::<String>::new().visit_seq(seq)?;
                if words.is_empty() {
                    return Err(de::Error::custom("an empty roster_command"));
                }
                Ok(RosterCommand(words))
            }
        }
        d.deserialize_any(V)
    }
}

/// Which roster to run (ticket 19 adds native Windows `local`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackendChoice {
    /// Detect: local on Linux; the default WSL distro, then running ones, on Windows.
    Auto,
    /// roster on this machine.
    Local,
    /// roster in WSL, in this distro (or found as with Auto).
    Wsl(Option<String>),
}

impl BackendChoice {
    /// The WSL distro it names, if any.
    pub fn distro(&self) -> Option<&str> {
        match self {
            BackendChoice::Wsl(Some(d)) => Some(d),
            _ => None,
        }
    }
}

impl Serialize for BackendChoice {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            BackendChoice::Auto => s.serialize_str("auto"),
            BackendChoice::Local => s.serialize_str("local"),
            BackendChoice::Wsl(None) => s.serialize_str("wsl"),
            BackendChoice::Wsl(Some(d)) => s.serialize_str(&format!("wsl:{d}")),
        }
    }
}

impl<'de> Deserialize<'de> for BackendChoice {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        match s.as_str() {
            "auto" => Ok(BackendChoice::Auto),
            "local" => Ok(BackendChoice::Local),
            "wsl" => Ok(BackendChoice::Wsl(None)),
            _ => match s.strip_prefix("wsl:").map(str::trim) {
                Some(d) if !d.is_empty() => Ok(BackendChoice::Wsl(Some(d.to_string()))),
                _ => Err(de::Error::custom(format!(
                    "{s:?}: say \"auto\", \"local\", \"wsl\" or \"wsl:<distro>\""
                ))),
            },
        }
    }
}

/// A Lua list. An empty Lua table `{}` can't say whether it's a list or a table, so an empty
/// table is accepted wherever a list is.
fn list<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Vec<T>, D::Error> {
    d.deserialize_any(ListVisitor::new())
}

fn opt_list<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<Vec<T>>, D::Error> {
    list(d).map(Some)
}

struct ListVisitor<T>(std::marker::PhantomData<T>);

impl<T> ListVisitor<T> {
    fn new() -> Self {
        ListVisitor(std::marker::PhantomData)
    }
}

impl<'de, T: Deserialize<'de>> Visitor<'de> for ListVisitor<T> {
    type Value = Vec<T>;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a list such as { \"a\", \"b\" }")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<T>, A::Error> {
        let mut out = Vec::new();
        while let Some(item) = seq.next_element()? {
            out.push(item);
        }
        Ok(out)
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Vec<T>, A::Error> {
        match map.next_key::<String>()? {
            None => Ok(Vec::new()),
            Some(k) => {
                let _ = map.next_value::<IgnoredAny>();
                Err(de::Error::custom(format!(
                    "expected a list such as {{ \"a\", \"b\" }}, found a table with key `{k}`"
                )))
            }
        }
    }
}
