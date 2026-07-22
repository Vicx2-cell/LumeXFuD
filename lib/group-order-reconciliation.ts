import { normalizeGroupOrderAddons } from '@/lib/group-order-addons'

export type GroupReconciliationIssue = {
  type: 'vendor_unavailable' | 'participant_incomplete' | 'budget_exceeded' | 'item_unavailable' | 'item_price_changed' | 'addon_unavailable' | 'addon_price_changed'
  participant_id?: string
  item_id?: string
  message: string
  previous_kobo?: number
  current_kobo?: number
}

export interface ReconciliationInput {
  vendorAvailable: boolean
  budgetKobo: number | null
  participants: Array<{ id: string; status: string }>
  items: Array<{
    id: string
    participant_id: string
    menu_item_id: string
    unit_price_kobo: number
    quantity: number
    addons: unknown
  }>
  currentItems: Map<string, { name: string; price_kobo: number; is_available: boolean }>
  currentAddons: Map<string, { name: string; price_kobo: number; is_available: boolean; menu_item_id: string }>
}

export function reconcileGroupOrder(input: ReconciliationInput): GroupReconciliationIssue[] {
  const issues: GroupReconciliationIssue[] = []
  if (!input.vendorAvailable) issues.push({ type: 'vendor_unavailable', message: 'The vendor is no longer available.' })

  for (const participant of input.participants) {
    if (participant.status !== 'READY') {
      issues.push({ type: 'participant_incomplete', participant_id: participant.id, message: 'Participant has not marked their contribution ready.' })
    }
  }

  const subtotalByParticipant = new Map<string, number>()
  for (const line of input.items) {
    const current = input.currentItems.get(line.menu_item_id)
    if (!current?.is_available) {
      issues.push({ type: 'item_unavailable', item_id: line.id, participant_id: line.participant_id, message: current ? `${current.name} is unavailable.` : 'A menu item no longer exists.' })
      continue
    }
    if (current.price_kobo !== line.unit_price_kobo) {
      issues.push({ type: 'item_price_changed', item_id: line.id, participant_id: line.participant_id, message: `${current.name} changed price.`, previous_kobo: line.unit_price_kobo, current_kobo: current.price_kobo })
    }

    let lineUnit = current.price_kobo
    for (const addon of normalizeGroupOrderAddons(line.addons)) {
      const live = input.currentAddons.get(addon.id)
      if (!live?.is_available || live.menu_item_id !== line.menu_item_id) {
        issues.push({ type: 'addon_unavailable', item_id: line.id, participant_id: line.participant_id, message: `${addon.name} is unavailable.` })
        continue
      }
      if (live.price_kobo !== addon.price_kobo) {
        issues.push({ type: 'addon_price_changed', item_id: line.id, participant_id: line.participant_id, message: `${live.name} changed price.`, previous_kobo: addon.price_kobo, current_kobo: live.price_kobo })
      }
      lineUnit += live.price_kobo
    }
    subtotalByParticipant.set(line.participant_id, (subtotalByParticipant.get(line.participant_id) ?? 0) + lineUnit * line.quantity)
  }

  if (input.budgetKobo !== null) {
    for (const [participantId, subtotal] of subtotalByParticipant) {
      if (subtotal > input.budgetKobo) {
        issues.push({ type: 'budget_exceeded', participant_id: participantId, message: 'Participant contribution exceeds the per-person budget.', current_kobo: subtotal })
      }
    }
  }
  return issues
}
