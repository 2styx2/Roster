//! The app's one Backend slot: starting a Backend can take a minute (detection, then serve's
//! first answer), and Tauri's async commands read the slot meanwhile, so a read must never wait
//! for a start.

use roster_core::slot::Slot;
use std::sync::Arc;
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

#[test]
fn reading_the_slot_does_not_wait_for_a_start_in_progress() {
    let slot: Arc<Slot<String>> = Arc::new(Slot::default());
    let (started_tx, started) = channel();
    let (release_tx, release) = channel::<()>();
    let s = Arc::clone(&slot);
    let connecting = std::thread::spawn(move || {
        s.connect(
            false,
            |_| true,
            || {
                started_tx.send(()).unwrap();
                release.recv().unwrap();
                Ok::<_, String>("backend".to_string())
            },
        )
    });
    started.recv().unwrap();
    let t = Instant::now();
    assert!(slot.get().is_none());
    assert!(
        t.elapsed() < Duration::from_millis(200),
        "get() waited {:?}",
        t.elapsed()
    );
    release_tx.send(()).unwrap();
    assert_eq!(*connecting.join().unwrap().unwrap(), "backend");
    assert_eq!(slot.get().as_deref().map(String::as_str), Some("backend"));
}

#[test]
fn a_live_backend_is_reused_and_a_dead_or_restarted_one_replaced() {
    let slot: Slot<u32> = Slot::default();
    let mut starts = 0;
    let mut start = || {
        starts += 1;
        Ok::<_, ()>(starts)
    };
    assert_eq!(*slot.connect(false, |_| true, &mut start).unwrap(), 1);
    assert_eq!(*slot.connect(false, |_| true, &mut start).unwrap(), 1);
    assert_eq!(*slot.connect(false, |_| false, &mut start).unwrap(), 2);
    assert_eq!(*slot.connect(true, |_| true, &mut start).unwrap(), 3);
    assert_eq!(slot.get().as_deref(), Some(&3));
}

#[test]
fn a_failed_start_leaves_the_slot_empty() {
    let slot: Slot<u32> = Slot::default();
    slot.connect(false, |_| true, || Ok::<_, &str>(1)).unwrap();
    assert_eq!(slot.connect(true, |_| true, || Err("nope")).unwrap_err(), "nope");
    assert!(slot.get().is_none());
}

#[test]
fn concurrent_connects_start_one_backend() {
    let slot: Arc<Slot<u32>> = Arc::new(Slot::default());
    let starts = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let threads: Vec<_> = (0..4)
        .map(|_| {
            let (slot, starts) = (Arc::clone(&slot), Arc::clone(&starts));
            std::thread::spawn(move || {
                slot.connect(
                    false,
                    |_| true,
                    || {
                        std::thread::sleep(Duration::from_millis(50));
                        Ok::<_, ()>(starts.fetch_add(1, std::sync::atomic::Ordering::SeqCst))
                    },
                )
                .unwrap()
            })
        })
        .collect();
    for t in threads {
        assert_eq!(*t.join().unwrap(), 0);
    }
    assert_eq!(starts.load(std::sync::atomic::Ordering::SeqCst), 1);
}
