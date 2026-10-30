//! Where the window opens: the size and place remembered in the State file (key `window`, written
//! by the frontend as the window settles), checked against the monitors there are now. A window
//! remembered on a monitor that's gone, or too small to use, opens at the default instead.
//! Physical pixels throughout, as Tauri reports them.

use serde_json::Value;

/// A rectangle in physical pixels (a monitor's work area, or the window).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn contains(&self, x: i64, y: i64) -> bool {
        x >= self.x as i64
            && y >= self.y as i64
            && x < self.x as i64 + self.width as i64
            && y < self.y as i64 + self.height as i64
    }
}

/// Where to put the window at start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub rect: Rect,
    pub maximized: bool,
}

/// Smallest size worth restoring; anything smaller was a mistake.
pub const MIN_WIDTH: u32 = 480;
pub const MIN_HEIGHT: u32 = 320;

/// How much of the title bar must be on a monitor for the window to count as reachable.
const GRAB: i64 = 48;

fn int(v: &Value, key: &str) -> Option<i64> {
    v.get(key)?.as_f64().filter(|f| f.is_finite()).map(|f| f.round() as i64)
}

/// The remembered placement from the State (`state.window`), if it's sane and its title bar
/// lands on one of `monitors`. A size bigger than that monitor is shrunk to fit it.
pub fn placement(state: &Value, monitors: &[Rect]) -> Option<Placement> {
    let w = state.get("window")?;
    let (x, y) = (int(w, "x")?, int(w, "y")?);
    let (width, height) = (int(w, "width")?, int(w, "height")?);
    let maximized = w.get("maximized").and_then(Value::as_bool).unwrap_or(false);
    if width < MIN_WIDTH as i64 || height < MIN_HEIGHT as i64 {
        return None;
    }
    // The title bar's top-left grab point (a little in from the corner) must be on a monitor.
    let monitor = monitors.iter().find(|m| m.contains(x + GRAB, y + GRAB / 2))?;
    let width = (width as u32).min(monitor.width);
    let height = (height as u32).min(monitor.height);
    Some(Placement {
        rect: Rect {
            x: i32::try_from(x).ok()?,
            y: i32::try_from(y).ok()?,
            width,
            height,
        },
        maximized,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const MAIN: Rect = Rect {
        x: 0,
        y: 0,
        width: 2560,
        height: 1400,
    };
    const LEFT: Rect = Rect {
        x: -1920,
        y: 200,
        width: 1920,
        height: 1040,
    };

    fn saved(x: i64, y: i64, w: i64, h: i64, max: bool) -> Value {
        json!({ "version": 1, "window": { "x": x, "y": y, "width": w, "height": h, "maximized": max } })
    }

    #[test]
    fn restores_a_window_on_a_monitor_there_is() {
        let p = placement(&saved(100, 80, 1200, 800, false), &[MAIN]).unwrap();
        assert_eq!(
            p,
            Placement {
                rect: Rect {
                    x: 100,
                    y: 80,
                    width: 1200,
                    height: 800
                },
                maximized: false
            }
        );
    }

    #[test]
    fn restores_on_a_second_monitor_left_of_the_main_one() {
        let p = placement(&saved(-1800, 300, 1000, 700, true), &[MAIN, LEFT]).unwrap();
        assert_eq!(p.rect.x, -1800);
        assert!(p.maximized);
    }

    #[test]
    fn ignores_a_window_whose_monitor_is_gone() {
        assert_eq!(placement(&saved(-1800, 300, 1000, 700, false), &[MAIN]), None);
        assert_eq!(placement(&saved(5000, 100, 1000, 700, false), &[MAIN]), None);
    }

    #[test]
    fn shrinks_a_window_bigger_than_its_monitor() {
        let p = placement(&saved(0, 0, 4000, 3000, false), &[MAIN]).unwrap();
        assert_eq!((p.rect.width, p.rect.height), (2560, 1400));
    }

    #[test]
    fn ignores_nothing_saved_or_nonsense() {
        assert_eq!(placement(&json!({}), &[MAIN]), None);
        assert_eq!(placement(&json!({ "window": "big" }), &[MAIN]), None);
        assert_eq!(placement(&saved(10, 10, 50, 40, false), &[MAIN]), None);
        assert_eq!(
            placement(
                &json!({ "window": { "x": 1, "y": 1, "width": "w", "height": 600 } }),
                &[MAIN]
            ),
            None
        );
    }
}
