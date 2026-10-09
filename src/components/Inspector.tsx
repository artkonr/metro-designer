import type { RefObject } from 'react'

import { readableText } from '../canvas/drawing'
import { labelOffsetForAngle } from '../canvas/geometry'
import { COLOR_PRESETS, LABEL_ANGLES } from '../domain/constants'
import { applyGroupNaming, fallbackStationName, generatedLineName, isWaypoint, moveLineToGroup, removeEmptyUnassigned, stationIcons } from '../domain/map'
import type { LineGroup, LineNamingPattern, LineStyle, MetroLine, MetroMap, SelectedConnection, Station } from '../domain/types'
import { LineSearchDropdown } from './LineSearchDropdown'
import { StyledDropdown } from './StyledDropdown'
import { MODALITY_ICON_URLS } from '../assets/modalityIcons'

type InspectorProps = {
  station?: Station
  stations: Station[]
  manualInterchanges: string[][]
  selectedStationIds: string[]
  interchangeAnchorId: string | null
  onStartManualInterchange: () => void
  line?: MetroLine
  group?: LineGroup
  lineGroups: LineGroup[]
  lines: MetroLine[]
  placementLineId: string | null
  selectedConnection: SelectedConnection | null
  isInterchange: boolean
  updateMap: (updater: (map: MetroMap) => MetroMap) => void
  onDelete: () => void
  onDeleteGroup: () => void
  onDeleteConnection: () => void
  onSelectLine: (id: string | null) => void
  onSelectPlacementLine: (id: string) => void
  onLineNameEnter: () => void
  stationNameInputRef: RefObject<HTMLTextAreaElement | null>
  lineNameInputRef: RefObject<HTMLTextAreaElement | null>
  groupNameInputRef: RefObject<HTMLInputElement | null>
  stationLineSelectRef: RefObject<HTMLInputElement | null>
  lineGroupSelectRef: RefObject<HTMLButtonElement | null>
  lineStyleSelectRef: RefObject<HTMLButtonElement | null>
}

export function Inspector({
  station,
  stations,
  manualInterchanges,
  selectedStationIds,
  interchangeAnchorId,
  onStartManualInterchange,
  line,
  group,
  lineGroups,
  lines,
  placementLineId,
  selectedConnection,
  isInterchange,
  updateMap,
  onDelete,
  onDeleteGroup,
  onDeleteConnection,
  onSelectLine,
  onSelectPlacementLine,
  onLineNameEnter,
  stationNameInputRef,
  lineNameInputRef,
  groupNameInputRef,
  stationLineSelectRef,
  lineGroupSelectRef,
  lineStyleSelectRef,
}: InspectorProps) {
  const waypoint = station ? isWaypoint(station) : false

  return (
    <section className="panel inspector">
      <div className="panel-heading">
        <h2>Inspector</h2>
        {(station || line || (group && !group.ephemeral)) && (
          <button className="delete-button" onClick={group && !station && !line ? onDeleteGroup : onDelete}>Delete</button>
        )}
      </div>
      {station ? (
        <>
          <div className="station-inspector-heading">
            <div className="selection-badge">{waypoint ? 'WAYPOINT' : 'STATION'}</div>
          </div>
          {!waypoint && (
            <div className="field">
              <label>Name</label>
              <textarea
                rows={1}
                key={station.id}
                ref={stationNameInputRef}
                value={flattenName(station.name)}
                onChange={(event) => updateMap((map) => ({
                  ...map,
                  stations: map.stations.map((item) => item.id === station.id
                    ? { ...item, name: mergeVisibleName(item.name, event.target.value) }
                    : item),
                }))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  if (event.shiftKey) {
                    event.preventDefault()
                    const input = event.currentTarget
                    const start = visibleCursorToRaw(station.name, input.selectionStart ?? input.value.length)
                    const end = visibleCursorToRaw(station.name, input.selectionEnd ?? input.selectionStart ?? input.value.length)
                    const name = `${station.name.slice(0, start)}\n${station.name.slice(end)}`
                    updateMap((map) => ({
                      ...map,
                      stations: map.stations.map((item) => item.id === station.id ? { ...item, name } : item),
                    }))
                    requestAnimationFrame(() => {
                      const position = input.selectionStart ?? input.value.length
                      input.setSelectionRange(position, position)
                    })
                    return
                  }
                  event.preventDefault()
                  event.currentTarget.blur()
                  requestAnimationFrame(() => stationLineSelectRef.current?.focus())
                }}
                onBlur={(event) => {
                  const name = event.currentTarget.value
                  updateMap((map) => ({
                    ...map,
                    stations: map.stations.map((item) => (
                      item.id === station.id
                        ? {
                            ...item,
                            name: flattenName(item.name) === name
                              ? item.name
                              : name.trim() ? mergeVisibleName(item.name, name) : fallbackStationName(map, item),
                          }
                        : item
                    )),
                  }))
                }}
              />
            </div>
          )}
          {!waypoint && manualInterchanges.some((interchangeGroup) => interchangeGroup.includes(station.id)) && (
            <label className="toggle-row station-label-toggle">
              <input
                type="checkbox"
                checked={station.hideLabel ?? false}
                onChange={(event) => updateMap((map) => ({
                  ...map,
                  stations: map.stations.map((item) => item.id === station.id ? { ...item, hideLabel: event.target.checked } : item),
                }))}
              />
              <span className="toggle"></span>
              <span>Hide station label</span>
            </label>
          )}
          <div className="field">
            <label>Line</label>
            <LineSearchDropdown ref={stationLineSelectRef} lines={lines} lineGroups={lineGroups} onSelect={onSelectPlacementLine} />
          </div>
          <div className="field">
            <label>Label angle</label>
            <StyledDropdown
              ref={lineStyleSelectRef}
              value={station.labelAngle === undefined ? 'manual' : String(station.labelAngle)}
              placeholder="Manual"
              options={[{ value: 'manual', label: 'Manual' }, ...LABEL_ANGLES.map((angle) => ({ value: String(angle), label: `${angle} deg` }))]}
              onChange={(value) => {
                if (value === 'manual') return
                const angle = Number(value)
                updateMap((map) => ({
                  ...map,
                  stations: map.stations.map((item) => selectedStationIds.includes(item.id)
                    ? { ...item, labelAngle: angle, labelOffset: labelOffsetForAngle(angle) }
                    : item),
                }))
              }}
            />
          </div>
          <div className="coordinates"><span>X {Math.round(station.x)}</span><span>Y {Math.round(station.y)}</span></div>
          <div className="station-action-tools">
            {!waypoint && (
              <div className="tool-grid station-style-tools" role="radiogroup" aria-label="Station style">
                <button
                  type="button"
                  className={!isInterchange ? 'tool active tooltip-button' : 'tool tooltip-button'}
                  aria-label="Regular station"
                  data-tooltip="Station"
                  aria-pressed={!isInterchange}
                  onClick={() => updateMap((map) => ({
                    ...map,
                    stations: map.stations.map((item) => item.id === station.id ? { ...item, interchangeStyle: 'regular' } : item),
                  }))}
                >
                  <span className="station-style-icon regular"></span>
                </button>
                <button
                  type="button"
                  className={isInterchange ? 'tool active tooltip-button' : 'tool tooltip-button'}
                  aria-label="Junction"
                  data-tooltip="Junction"
                  aria-pressed={isInterchange}
                  onClick={() => updateMap((map) => ({
                    ...map,
                    stations: map.stations.map((item) => item.id === station.id ? { ...item, interchangeStyle: 'converging' } : item),
                  }))}
                >
                  <span className="station-style-icon interchange"></span>
                </button>
              </div>
            )}
            <button
              type="button"
              className={interchangeAnchorId === station.id ? 'tool active manual-interchange-tool tooltip-button' : 'tool manual-interchange-tool tooltip-button'}
              aria-label={interchangeAnchorId === station.id ? 'Cancel interchange' : 'Interchange'}
              data-tooltip={interchangeAnchorId === station.id ? 'Cancel interchange' : 'Interchange'}
              aria-pressed={interchangeAnchorId === station.id}
              onClick={onStartManualInterchange}
            >
              <span>↔</span>
              <span>Interchange</span>
            </button>
          </div>
          <div className="field station-icon-field">
            <label>Modalities</label>
            <div className="tool-grid station-icon-tools" role="group" aria-label="Station modalities">
              {([['plane', 'Airport'], ['train', 'Rail station'], ['bus', 'Intercity bus'], ['ship', 'Passenger port']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={stationIcons(station).includes(value) ? 'tool active tooltip-button' : 'tool tooltip-button'}
                  aria-label={label}
                  data-tooltip={label}
                  aria-pressed={stationIcons(station).includes(value)}
                  onClick={() => updateMap((map) => ({
                    ...map,
                    stations: map.stations.map((item) => {
                      if (item.id !== station.id) return item
                      const icons = stationIcons(item)
                      const nextIcons = icons.includes(value) ? icons.filter((icon) => icon !== value) : [...icons, value]
                      return { ...item, icons: nextIcons }
                    }),
                  }))}
                >
                  <span className={`station-icon-glyph ${value}`}>
                    <img src={MODALITY_ICON_URLS[value]} alt="" />
                  </span>
                </button>
              ))}
            </div>
          </div>
          <h3>Connected lines</h3>
          {lineListForStation(station.id, lines, onSelectLine, (lineId) => updateMap((map) => ({
            ...map,
            lines: map.lines.map((item) => item.id === lineId ? { ...item, stationIds: item.stationIds.filter((id) => id !== station.id) } : item),
          })))}
          {manualInterchangeListForStation(station.id, manualInterchanges, stations, lines, (interchangeGroup) => updateMap((map) => ({
            ...map,
            manualInterchanges: (map.manualInterchanges ?? []).filter((item) => item.some((id) => !interchangeGroup.includes(id))),
          })))}
        </>
      ) : group ? (
        <>
          <div className="selection-badge line-badge">LINE GROUP</div>
          {group.ephemeral ? (
            <p className="muted">This group is managed automatically. Select a line to edit it.</p>
          ) : (
            <>
              <div className="field">
                <label>Name</label>
                <input
                  ref={groupNameInputRef}
                  value={group.name}
                  onChange={(event) => updateMap((map) => ({
                    ...map,
                    lineGroups: (map.lineGroups ?? []).map((item) => item.id === group.id ? { ...item, name: event.target.value } : item),
                  }))}
                />
              </div>
              <div className="field">
                <label>Default line style</label>
                <StyledDropdown
                  value={group.style}
                  options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'hollow', label: 'Hollow' }]}
                  onChange={(value) => updateMap((map) => ({
                    ...map,
                    lineGroups: (map.lineGroups ?? []).map((item) => item.id === group.id ? { ...item, style: value as LineStyle } : item),
                    lines: map.lines.map((item) => item.groupId === group.id && !item.styleOverridden ? { ...item, style: value as LineStyle } : item),
                  }))}
                />
              </div>
              <div className="field">
                <label>Line naming</label>
                <StyledDropdown
                  value={group.namingPattern}
                  options={[{ value: 'simple', label: 'Simple' }, { value: 'alphabet', label: 'Alphabetic' }, { value: 'numbered', label: 'Numbered' }]}
                  onChange={(value) => updateMap((map) => applyGroupNaming(map, group.id, { namingPattern: value as LineNamingPattern }))}
                />
              </div>
              {group.namingPattern !== 'simple' && (
                <div className="field">
                  <label>Prefix</label>
                  <input
                    value={group.namingPrefix ?? ''}
                    onChange={(event) => updateMap((map) => applyGroupNaming(map, group.id, { namingPrefix: event.target.value }))}
                    placeholder={group.namingPattern === 'numbered' ? 'e.g. MET' : 'Optional'}
                  />
                </div>
              )}
              <p className="muted">{group.lineIds.length} lines in this group</p>
            </>
          )}
        </>
      ) : line ? (
        <>
          <div className="selection-badge line-badge" style={{ background: line.color }}>LINE</div>
          <div className="field">
            <label>Name</label>
            <textarea
              rows={1}
              ref={lineNameInputRef}
              value={flattenName(line.name)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                if (event.shiftKey) {
                  event.preventDefault()
                  const input = event.currentTarget
                  const start = visibleCursorToRaw(line.name, input.selectionStart ?? input.value.length)
                  const end = visibleCursorToRaw(line.name, input.selectionEnd ?? input.selectionStart ?? input.value.length)
                  const name = `${line.name.slice(0, start)}\n${line.name.slice(end)}`
                  updateMap((map) => ({
                    ...map,
                    lines: map.lines.map((item) => item.id === line.id ? { ...item, name, nameOverridden: true } : item),
                  }))
                  requestAnimationFrame(() => {
                    const position = input.selectionStart ?? input.value.length
                    input.setSelectionRange(position, position)
                  })
                  return
                }
                event.preventDefault()
                event.currentTarget.blur()
                onLineNameEnter()
              }}
              onChange={(event) => updateMap((map) => ({
                ...map,
                lines: map.lines.map((item) => item.id === line.id
                  ? { ...item, name: mergeVisibleName(item.name, event.target.value), nameOverridden: true }
                  : item),
              }))}
            />
          </div>
          <div className="field">
            <label>Color</label>
            <input
              type="color"
              value={line.color}
              onChange={(event) => updateMap((map) => ({
                ...map,
                lines: map.lines.map((item) => item.id === line.id ? { ...item, color: event.target.value } : item),
              }))}
            />
            <div className="color-presets">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.color}
                  className={line.color.toLowerCase() === preset.color ? 'color-swatch active' : 'color-swatch'}
                  style={{ background: preset.color }}
                  title={preset.name}
                  aria-label={`Use ${preset.name}`}
                  onClick={() => updateMap((map) => ({
                    ...map,
                    lines: map.lines.map((item) => item.id === line.id ? { ...item, color: preset.color } : item),
                  }))}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <label>Group</label>
            <StyledDropdown
              ref={lineGroupSelectRef}
              value={line.groupId ?? lineGroups[0]?.id ?? ''}
              options={lineGroups.map((item) => ({ value: item.id, label: item.name || 'Unnamed group' }))}
              onChange={(value) => updateMap((map) => moveLineToGroup(map, line.id, value))}
            />
          </div>
          <div className="field">
            <label>Style</label>
            <StyledDropdown
              ref={lineStyleSelectRef}
              value={line.style}
              options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'hollow', label: 'Hollow' }]}
              onChange={(value) => updateMap((map) => ({
                ...map,
                lines: map.lines.map((item) => item.id === line.id ? { ...item, style: value as LineStyle, styleOverridden: true } : item),
              }))}
            />
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={line.loop ?? false}
              disabled={line.stationIds.length < 2}
              onChange={(event) => updateMap((map) => ({
                ...map,
                lines: map.lines.map((item) => item.id === line.id ? { ...item, loop: event.target.checked } : item),
              }))}
            />
            <span className="toggle"></span>
            <span>Loop line</span>
          </label>
          {selectedConnection?.lineId === line.id && <button className="delete-button wide" onClick={onDeleteConnection}>Delete connection</button>}
          <p className="muted">{line.stationIds.length} stations on this line</p>
        </>
      ) : (
        <p className="empty-state">Select a station or line to edit its properties.</p>
      )}
    </section>
  )
}

function flattenName(name: string) {
  return name.replace(/\n/g, ' ')
}

function mergeVisibleName(previousName: string, nextVisibleName: string) {
  const previousVisibleName = flattenName(previousName)
  if (previousVisibleName === nextVisibleName) return previousName

  let prefix = 0
  while (
    prefix < previousVisibleName.length
    && prefix < nextVisibleName.length
    && previousVisibleName[prefix] === nextVisibleName[prefix]
  ) prefix += 1

  let suffix = 0
  while (
    suffix < previousVisibleName.length - prefix
    && suffix < nextVisibleName.length - prefix
    && previousVisibleName[previousVisibleName.length - suffix - 1] === nextVisibleName[nextVisibleName.length - suffix - 1]
  ) suffix += 1

  const rawStart = visibleCursorToRaw(previousName, prefix)
  const rawEnd = visibleCursorToRaw(previousName, previousVisibleName.length - suffix)
  return `${previousName.slice(0, rawStart)}${nextVisibleName.slice(prefix, nextVisibleName.length - suffix)}${previousName.slice(rawEnd)}`
}

function visibleCursorToRaw(name: string, visiblePosition: number) {
  let visible = 0
  for (let index = 0; index < name.length; index += 1) {
    if (visible === visiblePosition) return index
    visible += 1
  }
  return name.length
}

function lineListForStation(
  stationId: string,
  lines: MetroLine[],
  onSelectLine: (id: string) => void,
  onRemoveLine: (id: string) => void,
) {
  return (
    <div className="connected-lines">
      {lines.filter((line) => line.stationIds.includes(stationId)).map((line) => (
        <div className="connected-line-row" key={line.id}>
          <button
            className="connected-line-main"
            style={{ background: line.color, color: readableText(line.color) }}
            onClick={() => onSelectLine(line.id)}
          >
            {line.name}
          </button>
          <button className="connected-line-remove" onClick={() => onRemoveLine(line.id)} aria-label={`Remove ${line.name} connection`}>×</button>
        </div>
      ))}
    </div>
  )
}

function manualInterchangeListForStation(
  stationId: string,
  groups: string[][],
  stations: Station[],
  lines: MetroLine[],
  onRemove: (group: string[]) => void,
) {
  const stationNames = new Map(stations.map((station) => [station.id, station.name || 'Unnamed station']))
  const connections = groups.filter((group) => group.includes(stationId))
  if (!connections.length) return null
  return (
    <div className="connected-lines manual-interchange-list">
      {connections.map((group) => {
        const otherIds = group.filter((id) => id !== stationId)
        const otherNames = otherIds.map((id) => stationNames.get(id) ?? 'Unnamed station').join(', ')
        const otherColor = lines.find((line) => otherIds.some((id) => line.stationIds.includes(id)))?.color ?? '#64748b'
        return (
          <div className="connected-line-row" key={group.join('|')}>
            <button type="button" className="connected-line-main" style={{ background: otherColor, color: readableText(otherColor) }}>↔ {otherNames}</button>
            <button className="connected-line-remove" onClick={() => onRemove(group)} aria-label="Remove interchange connection">×</button>
          </div>
        )
      })}
    </div>
  )
}
