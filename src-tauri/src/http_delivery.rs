//! Streaming HTTP micro-batching and Android WebView delivery with acknowledgements.
use crate::HttpAbortHandle;
use crate::NativeHttpChunkEvent;
#[cfg(target_os = "android")]
use crate::NATIVE_HTTP_CHUNK_EVENT;
use futures_util::{Stream, StreamExt};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
#[cfg(target_os = "android")]
use tauri::{Emitter, Window};
use tokio::sync::Notify;

pub const MICROBATCH_MAX_BYTES: usize = 16 * 1024;
pub const MICROBATCH_WINDOW: Duration = Duration::from_millis(4);

#[derive(Default)]
struct Pending {
    #[cfg(any(target_os = "android", test))]
    next: u64,
    bytes: usize,
    events: VecDeque<NativeHttpChunkEvent>,
}
#[derive(Default)]
struct Delivery {
    pending: Mutex<Pending>,
    consumed: Notify,
}
static DELIVERIES: OnceLock<Mutex<HashMap<Arc<str>, Arc<Delivery>>>> = OnceLock::new();
fn deliveries() -> &'static Mutex<HashMap<Arc<str>, Arc<Delivery>>> {
    DELIVERIES.get_or_init(Default::default)
}
fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
#[cfg(any(target_os = "android", test))]
pub fn register(id: &str) {
    lock_unpoisoned(deliveries()).insert(Arc::from(id), Arc::new(Delivery::default()));
}
pub fn remove(id: &str) {
    if let Some(entry) = lock_unpoisoned(deliveries()).remove(id) {
        entry.consumed.notify_waiters();
    }
}
fn clear_entries(map: &Mutex<HashMap<Arc<str>, Arc<Delivery>>>) {
    let entries: Vec<Arc<Delivery>> = lock_unpoisoned(map)
        .drain()
        .map(|(_, entry)| entry)
        .collect();
    for entry in entries {
        entry.consumed.notify_waiters();
    }
}
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn clear() {
    clear_entries(deliveries());
}

/// Coalesces ready small HTTP stream chunks up to `16 KiB` or `4ms`.
/// Flushes buffered tail immediately on normal EOF, and immediately discards
/// unsent buffered bytes if `abort` cancels.
pub async fn pump_microbatched_stream<S, B, E, F, Fut>(
    mut stream: S,
    abort: &HttpAbortHandle,
    mut emit_fn: F,
) where
    S: Stream<Item = Result<B, E>> + Unpin,
    B: AsRef<[u8]>,
    E: std::fmt::Display,
    F: FnMut(Arc<[u8]>, bool, Option<String>) -> Fut,
    Fut: Future<Output = ()>,
{
    let empty_chunk: Arc<[u8]> = Arc::from(&[][..]);
    let mut buf: Vec<u8> = Vec::with_capacity(MICROBATCH_MAX_BYTES);
    let mut flush_deadline: Option<tokio::time::Instant> = None;

    loop {
        if abort.is_aborted() {
            buf.clear();
            break;
        }

        tokio::select! {
            biased;
            _ = abort.cancelled() => {
                buf.clear();
                break;
            }
            item = stream.next() => {
                match item {
                    Some(Ok(bytes)) => {
                        if abort.is_aborted() {
                            buf.clear();
                            break;
                        }
                        let mut slice = bytes.as_ref();
                        while !slice.is_empty() {
                            if buf.is_empty() && slice.len() >= MICROBATCH_MAX_BYTES {
                                let part: Arc<[u8]> = Arc::from(&slice[..MICROBATCH_MAX_BYTES]);
                                slice = &slice[MICROBATCH_MAX_BYTES..];
                                emit_fn(part, false, None).await;
                                if abort.is_aborted() {
                                    buf.clear();
                                    break;
                                }
                            } else {
                                let was_empty = buf.is_empty();
                                let space = MICROBATCH_MAX_BYTES - buf.len();
                                let take = slice.len().min(space);
                                buf.extend_from_slice(&slice[..take]);
                                slice = &slice[take..];

                                if buf.len() >= MICROBATCH_MAX_BYTES {
                                    flush_deadline = None;
                                    if abort.is_aborted() {
                                        buf.clear();
                                        break;
                                    }
                                    let batch: Arc<[u8]> = Arc::from(buf.as_slice());
                                    buf.clear();
                                    emit_fn(batch, false, None).await;
                                } else if was_empty {
                                    flush_deadline = Some(tokio::time::Instant::now() + MICROBATCH_WINDOW);
                                }
                            }
                        }
                    }
                    Some(Err(error)) => {
                        if abort.is_aborted() {
                            buf.clear();
                            break;
                        }
                        if !buf.is_empty() {
                            let tail: Arc<[u8]> = Arc::from(buf.as_slice());
                            buf.clear();
                            emit_fn(tail, false, None).await;
                            if abort.is_aborted() {
                                break;
                            }
                        }
                        emit_fn(empty_chunk, true, Some(error.to_string())).await;
                        return;
                    }
                    None => {
                        if abort.is_aborted() {
                            buf.clear();
                        } else if !buf.is_empty() {
                            let tail: Arc<[u8]> = Arc::from(buf.as_slice());
                            buf.clear();
                            emit_fn(tail, false, None).await;
                        }
                        break;
                    }
                }
            }
            _ = async {
                if let Some(deadline) = flush_deadline {
                    tokio::time::sleep_until(deadline).await;
                } else {
                    std::future::pending::<()>().await;
                }
            } => {
                flush_deadline = None;
                if abort.is_aborted() {
                    buf.clear();
                    break;
                }
                if !buf.is_empty() {
                    let batch: Arc<[u8]> = Arc::from(buf.as_slice());
                    buf.clear();
                    emit_fn(batch, false, None).await;
                }
            }
        }
    }

    emit_fn(
        empty_chunk,
        true,
        abort
            .is_aborted()
            .then(|| String::from("Request was aborted")),
    )
    .await;
}

#[cfg(any(target_os = "android", test))]
impl Delivery {
    async fn enqueue(
        &self,
        mut event: NativeHttpChunkEvent,
        abort: &HttpAbortHandle,
    ) -> Option<NativeHttpChunkEvent> {
        loop {
            if abort.is_aborted() && !event.done {
                return None;
            }
            let notified = self.consumed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let mut pending = lock_unpoisoned(&self.pending);
                if (abort.is_aborted() && event.done)
                    || pending.events.is_empty()
                    || (pending.bytes + event.chunk.len() <= 256 * 1024
                        && pending.events.len() < 128)
                {
                    pending.next += 1;
                    event.sequence = Some(pending.next);
                    pending.bytes += event.chunk.len();
                    pending.events.push_back(event.clone());
                    return Some(event);
                }
            }
            tokio::select! {
                _ = notified => {},
                _ = abort.cancelled() => {},
            }
        }
    }
}

#[cfg(target_os = "android")]
pub async fn emit(window: &Window, event: NativeHttpChunkEvent, abort: &HttpAbortHandle) {
    let Some(delivery) = lock_unpoisoned(deliveries())
        .get(event.request_id.as_ref())
        .cloned()
    else {
        return;
    };
    if let Some(event) = delivery.enqueue(event, abort).await {
        let _ = window.emit(NATIVE_HTTP_CHUNK_EVENT, event);
    }
}

#[tauri::command]
pub fn acknowledge_http_chunks(request_id: String, sequence: u64) {
    let entry = lock_unpoisoned(deliveries())
        .get(request_id.as_str())
        .cloned();
    if let Some(entry) = entry {
        let mut pending = lock_unpoisoned(&entry.pending);
        let mut terminal = false;
        while let Some(front) = pending.events.front() {
            if front.sequence.is_some_and(|seq| seq <= sequence) {
                if let Some(event) = pending.events.pop_front() {
                    pending.bytes = pending.bytes.saturating_sub(event.chunk.len());
                    terminal |= event.done;
                }
            } else {
                break;
            }
        }
        drop(pending);
        entry.consumed.notify_waiters();
        if terminal {
            remove(&request_id);
        }
    }
}

#[tauri::command]
pub fn replay_http_chunks(request_id: String) -> Vec<NativeHttpChunkEvent> {
    lock_unpoisoned(deliveries())
        .get(request_id.as_str())
        .map(|entry| {
            lock_unpoisoned(&entry.pending)
                .events
                .iter()
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(id: &str, bytes: usize, done: bool) -> NativeHttpChunkEvent {
        NativeHttpChunkEvent {
            request_id: id.into(),
            sequence: None,
            chunk: Arc::from(vec![42; bytes]),
            done,
            error: None,
        }
    }
    #[tokio::test]
    async fn delivery_is_ordered_replayable_and_bounded_until_acknowledged() {
        let id = "bounded-test";
        register(id);
        let delivery = deliveries().lock().unwrap()[id].clone();
        let abort = Arc::new(HttpAbortHandle::new());
        for index in 1..=16 {
            assert_eq!(
                delivery
                    .enqueue(event(id, 16384, false), &abort)
                    .await
                    .unwrap()
                    .sequence,
                Some(index)
            );
        }
        let task = {
            let delivery = delivery.clone();
            let abort = abort.clone();
            tokio::spawn(async move { delivery.enqueue(event(id, 16384, false), &abort).await })
        };
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        assert_eq!(replay_http_chunks(id.into()).len(), 16);
        acknowledge_http_chunks(id.into(), 8);
        assert_eq!(task.await.unwrap().unwrap().sequence, Some(17));
        let replay = replay_http_chunks(id.into());
        assert_eq!(replay.first().unwrap().sequence, Some(9));
        assert_eq!(replay.last().unwrap().sequence, Some(17));
        let done = delivery.enqueue(event(id, 0, true), &abort).await.unwrap();
        acknowledge_http_chunks(id.into(), done.sequence.unwrap());
        assert!(replay_http_chunks(id.into()).is_empty());
    }
    #[tokio::test]
    async fn cancellation_unblocks_a_full_delivery_without_accepting_late_content() {
        let delivery = Arc::new(Delivery::default());
        let abort = Arc::new(HttpAbortHandle::new());
        for _ in 0..128 {
            delivery
                .enqueue(event("cancel-test", 1, false), &abort)
                .await
                .unwrap();
        }
        let task = {
            let delivery = delivery.clone();
            let abort = abort.clone();
            tokio::spawn(async move {
                delivery
                    .enqueue(event("cancel-test", 1, false), &abort)
                    .await
            })
        };
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        abort.cancel();
        assert!(task.await.unwrap().is_none());
        assert_eq!(delivery.pending.lock().unwrap().events.len(), 128);
        assert!(
            delivery
                .enqueue(event("cancel-test", 0, true), &abort)
                .await
                .unwrap()
                .done
        );
    }
    #[tokio::test]
    async fn clear_drains_all_registered_deliveries() {
        let map: Mutex<HashMap<Arc<str>, Arc<Delivery>>> = Mutex::new(HashMap::new());
        let delivery = Arc::new(Delivery::default());
        map.lock()
            .unwrap()
            .insert("clear-leak-test".into(), delivery.clone());
        let abort = Arc::new(HttpAbortHandle::new());
        delivery
            .enqueue(event("clear-leak-test", 1024, false), &abort)
            .await
            .unwrap();
        let notified = delivery.consumed.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        clear_entries(&map);
        assert!(map.lock().unwrap().is_empty());
        tokio::time::timeout(std::time::Duration::from_millis(200), notified)
            .await
            .expect("clearing delivery entries should wake blocked waiters");
    }

    #[tokio::test]
    async fn oversized_single_chunk_does_not_deadlock_and_blocks_next_until_acked() {
        let id = "oversized-chunk-test";
        register(id);
        let delivery = lock_unpoisoned(deliveries())[id].clone();
        let abort = Arc::new(HttpAbortHandle::new());
        let first = tokio::time::timeout(
            Duration::from_millis(200),
            delivery.enqueue(event(id, 300 * 1024, false), &abort),
        )
        .await
        .expect("oversized chunk on empty queue must not deadlock")
        .unwrap();
        assert_eq!(first.sequence, Some(1));

        let next_task = {
            let delivery = delivery.clone();
            let abort = abort.clone();
            tokio::spawn(async move { delivery.enqueue(event(id, 64, false), &abort).await })
        };
        tokio::task::yield_now().await;
        assert!(!next_task.is_finished());

        acknowledge_http_chunks(id.into(), 1);
        assert_eq!(next_task.await.unwrap().unwrap().sequence, Some(2));
        remove(id);
    }

    #[tokio::test]
    async fn microbatch_coalesces_burst_flushes_eof_tail_and_discards_buffered_on_cancel() {
        // 1. Burst of 40 small SSE-like chunks coalesces into 1 body event + 1 done event
        let chunks: Vec<Result<Vec<u8>, &'static str>> = (0..40)
            .map(|i| Ok(format!("data: {{\"idx\":{i}}}\n\n").into_bytes()))
            .collect();
        let expected_bytes: Vec<u8> = chunks
            .iter()
            .flat_map(|item| item.as_ref().unwrap().iter().copied())
            .collect();
        let abort = HttpAbortHandle::new();
        let emitted = Arc::new(Mutex::new(Vec::<(Vec<u8>, bool, Option<String>)>::new()));
        let emitted_ref = emitted.clone();

        pump_microbatched_stream(
            futures_util::stream::iter(chunks),
            &abort,
            move |chunk, done, err| {
                let emitted_ref = emitted_ref.clone();
                async move {
                    emitted_ref
                        .lock()
                        .unwrap()
                        .push((chunk.to_vec(), done, err));
                }
            },
        )
        .await;

        let captured = emitted.lock().unwrap().clone();
        assert_eq!(
            captured.len(),
            2,
            "40 burst chunks should coalesce into 1 tail + 1 done"
        );
        assert_eq!(captured[0].0, expected_bytes);
        assert!(!captured[0].1);
        assert!(captured[1].0.is_empty() && captured[1].1 && captured[1].2.is_none());

        // 2. Cancel while buffered bytes wait inside 4ms window immediately discards unsent bytes
        let abort_mid = Arc::new(HttpAbortHandle::new());
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Result<Vec<u8>, &'static str>>();
        tx.send(Ok(b"unsent-tail-before-cancel".to_vec())).unwrap();

        let emitted_cancel = Arc::new(Mutex::new(Vec::<(Vec<u8>, bool, Option<String>)>::new()));
        let emitted_cancel_ref = emitted_cancel.clone();
        let abort_for_pump = abort_mid.clone();

        let pump_handle = tokio::spawn(async move {
            struct RxStream(tokio::sync::mpsc::UnboundedReceiver<Result<Vec<u8>, &'static str>>);
            impl Stream for RxStream {
                type Item = Result<Vec<u8>, &'static str>;
                fn poll_next(
                    mut self: std::pin::Pin<&mut Self>,
                    cx: &mut std::task::Context<'_>,
                ) -> std::task::Poll<Option<Self::Item>> {
                    self.0.poll_recv(cx)
                }
            }
            pump_microbatched_stream(RxStream(rx), &abort_for_pump, move |chunk, done, err| {
                let emitted_cancel_ref = emitted_cancel_ref.clone();
                async move {
                    emitted_cancel_ref
                        .lock()
                        .unwrap()
                        .push((chunk.to_vec(), done, err));
                }
            })
            .await;
        });

        // Yield once so RxStream polls the buffered chunk into `buf` before the 4ms timer expires
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
        abort_mid.cancel();
        pump_handle.await.unwrap();

        let cancelled_events = emitted_cancel.lock().unwrap().clone();
        assert_eq!(
            cancelled_events.len(),
            1,
            "buffered unsent bytes must be discarded on cancel"
        );
        assert!(cancelled_events[0].0.is_empty());
        assert!(cancelled_events[0].1);
        assert_eq!(
            cancelled_events[0].2.as_deref(),
            Some("Request was aborted")
        );
    }
}
