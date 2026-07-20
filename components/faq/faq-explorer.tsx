'use client'

import Link from 'next/link'
import {
  ArrowRight,
  ChevronDown,
  LifeBuoy,
  Search,
  SearchX,
  X,
} from 'lucide-react'
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { BrandLogo } from '@/components/brand-logo'
import { EmptyState } from '@/components/ui/empty-state'
import { ThemeToggleButton } from '@/components/theme-toggle-button'
import {
  FAQ_ROLES,
  FAQ_ROLE_LABELS,
  buildFaqJsonLd,
  filterFaqItems,
  findFaqByHash,
  getKeyboardNavigationIndex,
  toggleFaqItem,
  type FaqItem,
  type FaqRole,
} from '@/lib/faq'
import styles from './faq.module.css'

function replaceHash(id?: string) {
  const next = `${window.location.pathname}${window.location.search}${id ? `#${id}` : ''}`
  window.history.replaceState(null, '', next)
}

function scrollToFaq(id: string) {
  // Timers are used instead of animation frames so hash navigation also runs
  // promptly in background tabs and WebKit, where rAF can be heavily throttled.
  window.setTimeout(() => {
    window.setTimeout(() => {
      const trigger = document.getElementById(`${id}-trigger`)
      if (!trigger) return
      trigger.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      })
      trigger.focus({ preventScroll: true })
    }, 0)
  }, 0)
}

function focusAccordionTrigger(current: HTMLButtonElement, key: string) {
  const triggers = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-faq-trigger="true"]'))
  const index = triggers.indexOf(current)
  if (index < 0 || triggers.length === 0) return
  const nextIndex = getKeyboardNavigationIndex(index, key, triggers.length, 'vertical')
  if (nextIndex !== null) triggers[nextIndex]?.focus()
}

const AccordionItem = memo(function AccordionItem({
  item,
  open,
  onToggle,
}: {
  item: FaqItem
  open: boolean
  onToggle: (id: string) => void
}) {
  const panelId = `${item.id}-panel`
  const triggerId = `${item.id}-trigger`

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusAccordionTrigger(event.currentTarget, event.key)
    }
  }

  return (
    <article id={item.id} className={styles.item} data-open={open}>
      <h3>
        <button
          id={triggerId}
          type="button"
          className={styles.question}
          aria-expanded={open}
          aria-controls={panelId}
          data-faq-trigger="true"
          onClick={() => onToggle(item.id)}
          onKeyDown={handleKeyDown}
        >
          <span>{item.question}</span>
          <span className={styles.chevron} aria-hidden="true">
            <ChevronDown size={19} strokeWidth={2.2} />
          </span>
        </button>
      </h3>
      <div
        id={panelId}
        className={styles.answerGrid}
        role="region"
        aria-labelledby={triggerId}
        aria-hidden={!open}
      >
        <div className={styles.answerClip}>
          <p className={styles.answer}>{item.answer}</p>
        </div>
      </div>
    </article>
  )
})

export function FaqExplorer() {
  const [role, setRole] = useState<FaqRole>('customers')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(query)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const visibleItems = useMemo(() => filterFaqItems(role, deferredQuery), [role, deferredQuery])
  const groups = useMemo(() => {
    const result = new Map<string, FaqItem[]>()
    for (const item of visibleItems) {
      const group = result.get(item.category) ?? []
      group.push(item)
      result.set(item.category, group)
    }
    return [...result.entries()]
  }, [visibleItems])
  const jsonLd = useMemo(() => buildFaqJsonLd(visibleItems), [visibleItems])

  const activateHash = useCallback(() => {
    const match = findFaqByHash(window.location.hash)
    if (!match) return
    setRole(match.role)
    setQuery('')
    setOpenId(match.id)
    scrollToFaq(match.id)
  }, [])

  useEffect(() => {
    // Read the URL after hydration. Scheduling avoids a cascading render in the
    // effect body while still resolving a copied deep link before first input.
    const timeout = window.setTimeout(activateHash, 0)
    window.addEventListener('hashchange', activateHash)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('hashchange', activateHash)
    }
  }, [activateHash])

  const toggleItem = useCallback((id: string) => {
    setOpenId((current) => {
      const next = toggleFaqItem(current, id)
      replaceHash(next ?? undefined)
      return next
    })
  }, [])

  function selectRole(nextRole: FaqRole) {
    setRole(nextRole)
    setOpenId(null)
    replaceHash()
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = getKeyboardNavigationIndex(index, event.key, FAQ_ROLES.length, 'horizontal')
    if (nextIndex === null) return
    event.preventDefault()
    const nextRole = FAQ_ROLES[nextIndex]
    selectRole(nextRole)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div className={styles.page}>
      {jsonLd && (
        <script
          type="application/ld+json"
          data-faq-jsonld="true"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}

      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link href="/" className={styles.brand} aria-label="LumeX Fud home">
            <BrandLogo size={34} rounded={10} priority />
            <span><strong>LumeX</strong> Fud</span>
          </Link>
          <div className={styles.headerActions}>
            <ThemeToggleButton />
            <Link href="/contact" className={styles.headerHelp}>Contact support</Link>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="faq-title">
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroInner}>
            <p className={styles.eyebrow}><LifeBuoy size={14} /> Help center</p>
            <h1 id="faq-title">Questions? Let’s sort them out.</h1>
            <p className={styles.subtitle}>Clear answers for ordering, selling, and delivering with LumeX Fud.</p>

            <label className={styles.searchBox}>
              <span className="sr-only">Search frequently asked questions</span>
              <Search size={20} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${FAQ_ROLE_LABELS[role].toLowerCase()} help`}
                autoComplete="off"
                aria-describedby="faq-result-count"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={18} />
                </button>
              )}
            </label>
          </div>
        </section>

        <section className={styles.content} aria-label="Frequently asked questions">
          <div className={styles.tabs} role="tablist" aria-label="Help for">
            {FAQ_ROLES.map((tabRole, index) => (
              <button
                key={tabRole}
                ref={(node) => { tabRefs.current[index] = node }}
                type="button"
                id={`${tabRole}-tab`}
                role="tab"
                aria-selected={role === tabRole}
                aria-controls="faq-tabpanel"
                tabIndex={role === tabRole ? 0 : -1}
                data-active={role === tabRole}
                onClick={() => selectRole(tabRole)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {FAQ_ROLE_LABELS[tabRole]}
              </button>
            ))}
          </div>

          <div
            id="faq-tabpanel"
            role="tabpanel"
            aria-labelledby={`${role}-tab`}
            className={styles.panel}
          >
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.panelKicker}>{FAQ_ROLE_LABELS[role]} help</p>
                <h2>{deferredQuery ? 'Search results' : 'Browse by topic'}</h2>
              </div>
              <p id="faq-result-count" className={styles.resultCount} aria-live="polite" aria-atomic="true">
                {visibleItems.length} {visibleItems.length === 1 ? 'answer' : 'answers'}
              </p>
            </div>

            {groups.length > 0 ? (
              <div className={styles.groupList}>
                {groups.map(([category, items]) => (
                  <section key={category} className={styles.group} aria-labelledby={`category-${items[0].id}`}>
                    <div className={styles.categoryHeading}>
                      <span aria-hidden="true" />
                      <h2 id={`category-${items[0].id}`}>{category}</h2>
                    </div>
                    <div className={styles.accordion}>
                      {items.map((item) => (
                        <AccordionItem key={item.id} item={item} open={openId === item.id} onToggle={toggleItem} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className={styles.emptyWrap}>
                <EmptyState
                  icon={<SearchX size={24} />}
                  title="No answers found"
                  description={`Try a shorter phrase, or search another ${FAQ_ROLE_LABELS[role].toLowerCase()} topic.`}
                  action={(
                    <button type="button" className="lx-btn-ghost px-4 py-2" onClick={() => setQuery('')}>
                      Clear search
                    </button>
                  )}
                />
              </div>
            )}
          </div>
        </section>

        <section className={styles.support} aria-labelledby="support-title">
          <div className={styles.supportIcon} aria-hidden="true"><LifeBuoy size={25} /></div>
          <div>
            <p className={styles.panelKicker}>Still need a hand?</p>
            <h2 id="support-title">Talk to a real person.</h2>
            <p>Tell us what happened and include your order number when your question is about an order.</p>
          </div>
          <Link href="/contact" className={styles.supportButton}>
            Contact support <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </section>
      </main>
    </div>
  )
}
