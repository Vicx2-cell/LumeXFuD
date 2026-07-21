'use client'

import { useCallback, useEffect, useState } from 'react'
import type { OrderConversationChannel } from '@/lib/order-communication'

interface UnreadRow {
  order_id: string
  channel: OrderConversationChannel
  unread_count: number
}

export function useOrderChatUnread(enabled = true) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/order-communications/unread', { cache: 'no-store' })
      if (!response.ok) return
      const payload = await response.json() as { counts: UnreadRow[] }
      setCounts(Object.fromEntries(payload.counts.map((row) => [
        `${row.order_id}:${row.channel}`,
        row.unread_count,
      ])))
    } catch { /* polling is best-effort; the sheet remains authoritative */ }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 15_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, refresh])

  const unreadFor = useCallback((orderId: string, channel: OrderConversationChannel) => (
    counts[`${orderId}:${channel}`] ?? 0
  ), [counts])

  const clearUnread = useCallback((orderId: string, channel: OrderConversationChannel) => {
    setCounts((current) => {
      const key = `${orderId}:${channel}`
      return current[key] === 0 ? current : { ...current, [key]: 0 }
    })
  }, [])

  return { unreadFor, clearUnread, refresh }
}
