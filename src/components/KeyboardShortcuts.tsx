export function KeyboardShortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null

  return (
    <div className="help-popup" role="dialog" aria-label="Keyboard shortcuts">
      <div className="help-popup-heading">
        <h2>Keyboard shortcuts</h2>
        <button className="help-close" aria-label="Close keyboard shortcuts" onClick={onClose}>×</button>
      </div>
      <div className="shortcut-list">
        <div className="shortcut-group">
          <h3>Navigation</h3>
          <span><kbd>Q</kbd><b>Zoom out</b></span>
          <span><kbd>E</kbd><b>Zoom in</b></span>
          <span><kbd>W A S D</kbd><b>Move map</b></span>
          <span><kbd>1</kbd><b>Select tool</b></span>
        </div>
        <div className="shortcut-group">
          <h3>Objects</h3>
          <span><kbd>2</kbd><b>Place station</b></span>
          <span><kbd>3</kbd><b>Place waypoint</b></span>
          <span><kbd>L</kbd><b>New line</b></span>
          <span><kbd>G</kbd><b>New line group</b></span>
        </div>
        <div className="shortcut-group">
          <h3>Inspector</h3>
          <span><kbd>N</kbd><b>Focus on name</b></span>
          <span><kbd>C</kbd><b>Focus on line selector</b></span>
          <span><kbd>Delete</kbd><b>Delete selected item</b></span>
          <span><kbd>H</kbd><b>Rotate station label</b></span>
        </div>
        <div className="shortcut-group">
          <h3>Bulk actions</h3>
          <span><kbd>4</kbd><b>Frame selector</b></span>
          <span><kbd>F</kbd><b>Move to next station</b></span>
          <span><kbd>R</kbd><b>Move to previous station</b></span>
        </div>
      </div>
    </div>
  )
}
