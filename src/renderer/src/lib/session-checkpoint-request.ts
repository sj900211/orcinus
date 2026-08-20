/**
 * Serves main's on-demand session checkpoint requests (sent to the main window
 * before a workspace window opens, so it hydrates this run's live tabs).
 * Always replies — a failed checkpoint reports ok:false and main degrades to
 * the last persisted session.
 */
export function registerSessionCheckpointRequestListener(stageCheckpoint: () => void): () => void {
  // Optional-chained: the web preload and older test doubles expose a partial session API.
  const subscribe = window.api.session.onCheckpointRequest
  if (typeof subscribe !== 'function') {
    return () => {}
  }
  return subscribe(({ requestId }) => {
    let ok = true
    try {
      stageCheckpoint()
    } catch (error) {
      ok = false
      console.error('[app] On-demand session checkpoint failed:', error)
    }
    window.api.session.sendCheckpointReply?.({ requestId, ok })
  })
}
