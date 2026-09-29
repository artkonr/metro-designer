import type { PointerEventHandler, RefObject, WheelEventHandler } from 'react'

import { WORKSPACE } from '../domain/constants'

export function MapCanvas({
  canvasRef,
  status,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  status: string
  onPointerDown: PointerEventHandler<HTMLCanvasElement>
  onPointerMove: PointerEventHandler<HTMLCanvasElement>
  onPointerUp: PointerEventHandler<HTMLCanvasElement>
  onWheel: WheelEventHandler<HTMLCanvasElement>
}) {
  return (
    <section className="canvas-wrap">
      <canvas
        ref={canvasRef}
        width={WORKSPACE.width}
        height={WORKSPACE.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      />
      <div className="canvas-status">{status}</div>
    </section>
  )
}
