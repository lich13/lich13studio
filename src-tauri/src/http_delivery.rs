//! Android WebView delivery with acknowledgements and bounded backpressure.
use crate::{NativeHttpChunkEvent, NATIVE_HTTP_CHUNK_EVENT};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, Window};
use tokio::sync::Notify;

#[derive(Default)]
struct Pending {
  next: u64,
  bytes: usize,
  events: BTreeMap<u64, NativeHttpChunkEvent>,
}
#[derive(Default)]
struct Delivery {
  pending: Mutex<Pending>,
  consumed: Notify,
}
static DELIVERIES: OnceLock<Mutex<HashMap<String, Arc<Delivery>>>> = OnceLock::new();
fn deliveries() -> &'static Mutex<HashMap<String, Arc<Delivery>>> {
  DELIVERIES.get_or_init(Default::default)
}
pub fn register(id: &str) {
  deliveries()
    .lock()
    .unwrap()
    .insert(id.to_owned(), Arc::new(Delivery::default()));
}
pub fn remove(id: &str) {
  if let Some(entry) = deliveries().lock().unwrap().remove(id) {
    entry.consumed.notify_one();
  }
}

impl Delivery {
  async fn enqueue(
    &self,
    mut event: NativeHttpChunkEvent,
    abort: &AtomicBool,
  ) -> Option<NativeHttpChunkEvent> {
    loop {
      if abort.load(Ordering::Relaxed) && !event.done {
        return None;
      }
      let notified = self.consumed.notified();
      {
        let mut pending = self.pending.lock().unwrap();
        if (abort.load(Ordering::Relaxed) && event.done)
          || (pending.bytes + event.chunk.len() <= 256 * 1024 && pending.events.len() < 128)
        {
          pending.next += 1;
          event.sequence = Some(pending.next);
          pending.bytes += event.chunk.len();
          let next = pending.next;
          pending.events.insert(next, event.clone());
          return Some(event);
        }
      }
      tokio::select! { _ = notified => {}, _ = crate::wait_for_http_abort(abort) => {} }
    }
  }
}

pub async fn emit(window: &Window, event: NativeHttpChunkEvent, abort: &AtomicBool) {
  let Some(delivery) = deliveries().lock().unwrap().get(&event.request_id).cloned() else {
    return;
  };
  if let Some(event) = delivery.enqueue(event, abort).await {
    let _ = window.emit(NATIVE_HTTP_CHUNK_EVENT, event);
  }
}

#[tauri::command]
pub fn acknowledge_http_chunks(request_id: String, sequence: u64) {
  let entry = deliveries().lock().unwrap().get(&request_id).cloned();
  if let Some(entry) = entry {
    let mut pending = entry.pending.lock().unwrap();
    let mut terminal = false;
    let keys: Vec<u64> = pending
      .events
      .range(..=sequence)
      .map(|(key, _)| *key)
      .collect();
    for key in keys {
      if let Some(event) = pending.events.remove(&key) {
        pending.bytes -= event.chunk.len();
        terminal |= event.done;
      }
    }
    drop(pending);
    entry.consumed.notify_one();
    if terminal {
      remove(&request_id);
    }
  }
}

#[tauri::command]
pub fn replay_http_chunks(request_id: String) -> Vec<NativeHttpChunkEvent> {
  deliveries()
    .lock()
    .unwrap()
    .get(&request_id)
    .map(|entry| {
      entry
        .pending
        .lock()
        .unwrap()
        .events
        .values()
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
      chunk: vec![42; bytes],
      done,
      error: None,
    }
  }
  #[tokio::test]
  async fn delivery_is_ordered_replayable_and_bounded_until_acknowledged() {
    let id = "bounded-test";
    register(id);
    let delivery = deliveries().lock().unwrap()[id].clone();
    let abort = Arc::new(AtomicBool::new(false));
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
    let abort = Arc::new(AtomicBool::new(false));
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
    abort.store(true, Ordering::SeqCst);
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
}
