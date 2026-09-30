export type Point = { x: number; y: number }

export type Viewport = { x: number; y: number; scale: number }

export type Tool = 'select' | 'station' | 'waypoint' | 'frame'

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'hollow'

export type LineNamingPattern = 'simple' | 'alphabet' | 'numbered'

export type StationIcon = 'none' | 'train' | 'bus' | 'plane' | 'ship'

export type StationDragState = { type: 'station' | 'label'; id: string; offset: Point }

export type DragEditState =
  | StationDragState
  | { type: 'line-label'; id: string; offset: Point; group?: boolean }

export type DragState =
  | DragEditState
  | { type: 'pan'; start: Point; viewport: Viewport }
  | null

export type Station = {
  id: string
  name: string
  ghost?: boolean
  interchangeStyle?: 'regular' | 'converging'
  x: number
  y: number
  labelOffset: Point
  labelAngle?: number
  hideLabel?: boolean
  icon: StationIcon
  icons?: StationIcon[]
}

export type MetroLine = {
  id: string
  name: string
  color: string
  style: LineStyle
  styleOverridden?: boolean
  nameOverridden?: boolean
  groupId?: string
  stationIds: string[]
  loop?: boolean
  deletedConnections?: string[]
}

export type LineGroup = {
  id: string
  name: string
  style: LineStyle
  namingPattern: LineNamingPattern
  namingPrefix?: string
  lineIds: string[]
  ephemeral?: boolean
}

export type MetroMap = {
  version: 1
  title: string
  stations: Station[]
  lines: MetroLine[]
  lineGroups?: LineGroup[]
  manualInterchanges?: string[][]
  lineLabelOffsets?: Record<string, Point>
  terminusLabelOffsets?: Record<string, Point>
}

export type LineEndpointLabel = {
  key: string
  groupKey: string
  group: boolean
  station: Station
  label: string
  center: Point
  width: number
  height: number
  color: string
}

export type RouteTransfer = {
  stationId: string
  type: 'junction' | 'interchange'
}

export type RouteAnalysis = {
  fromId: string
  toId: string
  changes: number
  lineIds: string[]
  transfers: RouteTransfer[]
}

export type SelectedConnection = {
  lineId: string
  startId: string
  endId: string
}

export type FrameSelection = {
  start: Point
  end: Point
}
