import { useEffect, useReducer, useRef, useState } from 'react'
import { annotationReducer, cursorReducer } from './state'
import type { Annotation, Point, SocketMessage, TacMap } from './types'

export const reconnectDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 10_000)

export function useCollaboration(mapID: string, initial: TacMap) {
  const [map, dispatch] = useReducer(annotationReducer, initial)
  const [cursors, dispatchCursor] = useReducer(cursorReducer, {})
  const [connected, setConnected] = useState(false)
  const socket = useRef<WebSocket | null>(null)

  useEffect(() => {
    let stopped = false
    let retry: number | undefined
    let attempt = 0
    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${location.host}/api/maps/${mapID}/ws`)
      socket.current = ws
      ws.onopen = () => { attempt = 0; setConnected(true) }
      ws.onmessage = ({ data }) => { const message = JSON.parse(data) as SocketMessage; dispatch(message); dispatchCursor(message) }
      ws.onclose = () => {
        setConnected(false)
        if (!stopped) retry = window.setTimeout(connect, reconnectDelay(attempt++))
      }
    }
    connect()
    return () => { stopped = true; if (retry) clearTimeout(retry); socket.current?.close() }
  }, [mapID])

  const send = (message: SocketMessage) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false
    socket.current.send(JSON.stringify(message))
    return true
  }
  return {
    map,
    connected,
    cursors,
    create: (annotation: Omit<Annotation, 'id' | 'mapId'>) => send({ type: 'mutation', operation: 'create', annotation: annotation as Annotation }),
    update: (annotation: Annotation) => send({ type: 'mutation', operation: 'update', id: annotation.id, annotation }),
    remove: (id: string) => send({ type: 'mutation', operation: 'delete', id }),
    cursor: (cursor: Point | null) => send({ type: 'cursor', cursor }),
  }
}
