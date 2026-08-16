/**
 * arXiv Citation Popup Feature
 *
 * Intercepts clicks on citation links and displays the corresponding
 * bibliography entry in a lightweight, non-intrusive popup.
 */

let activePopup: HTMLElement | null = null
let activeAnchor: HTMLAnchorElement | null = null
let isInitialized = false

/**
 * Selectors for citation links in arXiv / ar5iv HTML papers.
 */
const CITATION_LINK_SELECTOR =
  'a[href^="#bib"], a[href^="#Bib"], a.ltx_ref[href*="bib"], a[role="doc-biblioref"]'

/**
 * Find the target bibliography element for a given anchor link.
 */
export function findBibliographyTarget(
  link: HTMLAnchorElement,
  doc: Document = document,
): HTMLElement | null {
  const href = link.getAttribute('href')
  if (!href || !href.startsWith('#')) return null

  const rawId = href.slice(1)
  if (!rawId) return null

  try {
    const targetId = decodeURIComponent(rawId)
    // 1. Direct ID lookup
    const el = doc.getElementById(targetId)
    if (el) return el

    // 2. Query selector by ID escaping
    if (typeof CSS !== 'undefined' && CSS.escape) {
      const escaped = doc.querySelector(`[id="${CSS.escape(targetId)}"]`)
      if (escaped) return escaped as HTMLElement
    }

    // 3. Name attribute fallback
    const byName = doc.getElementsByName(targetId)[0]
    if (byName) return byName as HTMLElement
  } catch {
    // If decoding or escaping fails, fallback gracefully
  }

  return null
}

/**
 * Position the popup relative to the anchor within the viewport.
 */
function positionPopup(popup: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  const margin = 10
  const offset = 6

  popup.style.visibility = 'hidden'
  popup.style.display = 'block'

  const popupRect = popup.getBoundingClientRect()
  const popupWidth = popupRect.width || 380
  const popupHeight = popupRect.height || 120

  let left = rect.left
  if (left + popupWidth > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - popupWidth - margin)
  }
  if (left < margin) {
    left = margin
  }

  let top = rect.bottom + offset
  // If it overflows the bottom of the viewport, flip it above the link if there's room
  if (top + popupHeight > window.innerHeight - margin) {
    const topAbove = rect.top - popupHeight - offset
    if (topAbove >= margin) {
      top = topAbove
    } else {
      top = Math.max(margin, window.innerHeight - popupHeight - margin)
    }
  }

  popup.style.left = `${Math.round(left)}px`
  popup.style.top = `${Math.round(top)}px`
  popup.style.visibility = 'visible'
}

/**
 * Create or reuse the popup container element.
 */
function getOrCreatePopupElement(): HTMLElement {
  let popup = document.getElementById(
    'arxiv-citation-popup',
  ) as HTMLElement | null
  if (popup) return popup

  popup = document.createElement('div')
  popup.id = 'arxiv-citation-popup'
  popup.className = 'arxiv-citation-popup'
  popup.style.cssText = `
    position: fixed;
    z-index: 100000;
    width: max-content;
    max-width: min(480px, calc(100vw - 24px));
    max-height: min(320px, calc(100vh - 40px));
    background: #ffffff;
    color: #24292f;
    border: 1px solid #d0d7de;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(140, 149, 159, 0.2), 0 2px 6px rgba(140, 149, 159, 0.15);
    padding: 12px 14px 10px 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    display: none;
    box-sizing: border-box;
    overflow-y: auto;
  `

  document.body.appendChild(popup)
  return popup
}

/**
 * Hide the active citation popup.
 */
export function hideCitationPopup(): void {
  if (activePopup) {
    activePopup.style.display = 'none'
  }
  activeAnchor = null
}

/**
 * Show citation popup for a specific link and bibliography target.
 */
export function showCitationPopup(
  link: HTMLAnchorElement,
  target: HTMLElement,
): void {
  const popup = getOrCreatePopupElement()
  activePopup = popup
  activeAnchor = link

  // Clear existing content
  popup.innerHTML = ''

  // Container for header/actions
  const header = document.createElement('div')
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid #f0f2f5;
  `

  const title = document.createElement('span')
  title.textContent = 'Citation Reference'
  title.style.cssText = `
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #57606a;
  `
  header.appendChild(title)

  const btnGroup = document.createElement('div')
  btnGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;'

  // Jump to bibliography button
  const jumpBtn = document.createElement('button')
  jumpBtn.textContent = 'Jump ↗'
  jumpBtn.title = 'Jump to bibliography section'
  jumpBtn.style.cssText = `
    background: none;
    border: none;
    color: #0969da;
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  `
  jumpBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    hideCitationPopup()
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
  btnGroup.appendChild(jumpBtn)

  // Close button
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '✕'
  closeBtn.title = 'Close'
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: #57606a;
    font-size: 12px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  `
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    hideCitationPopup()
  })
  btnGroup.appendChild(closeBtn)

  header.appendChild(btnGroup)
  popup.appendChild(header)

  // Content body
  const body = document.createElement('div')
  body.className = 'arxiv-citation-body'
  body.style.cssText = 'word-break: break-word;'
  body.innerHTML = target.innerHTML
  popup.appendChild(body)

  positionPopup(popup, link)
}

/**
 * Global click handler for event delegation.
 */
function handleDocumentClick(e: MouseEvent): void {
  // If click is inside the popup, let it interact normally
  if (activePopup && activePopup.contains(e.target as Node)) {
    return
  }

  const target = e.target as HTMLElement | null
  const link = target?.closest<HTMLAnchorElement>(CITATION_LINK_SELECTOR)

  // Check if click was on a matching citation link
  if (
    link &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    !e.altKey &&
    e.button === 0
  ) {
    const bibTarget = findBibliographyTarget(link)
    if (bibTarget) {
      e.preventDefault()
      e.stopPropagation()

      // Toggle off if clicking the active link again
      if (
        activeAnchor === link &&
        activePopup &&
        activePopup.style.display !== 'none'
      ) {
        hideCitationPopup()
      } else {
        showCitationPopup(link, bibTarget)
      }
      return
    }
  }

  // Clicked outside — close popup if visible
  if (activePopup && activePopup.style.display !== 'none') {
    hideCitationPopup()
  }
}

/**
 * Keydown handler for Escape dismissal.
 */
function handleKeyDown(e: KeyboardEvent): void {
  if (
    e.key === 'Escape' && activePopup && activePopup.style.display !== 'none'
  ) {
    hideCitationPopup()
  }
}

/**
 * Initialize citation popup listeners on the document.
 */
export function initCitationPopup(): () => void {
  if (isInitialized) {
    return destroyCitationPopup
  }
  isInitialized = true

  document.addEventListener('click', handleDocumentClick, true)
  document.addEventListener('keydown', handleKeyDown, true)

  return destroyCitationPopup
}

/**
 * Destroy citation popup listeners and remove popup DOM elements.
 */
export function destroyCitationPopup(): void {
  if (!isInitialized) return
  isInitialized = false

  document.removeEventListener('click', handleDocumentClick, true)
  document.removeEventListener('keydown', handleKeyDown, true)

  hideCitationPopup()

  if (activePopup && activePopup.parentElement) {
    activePopup.parentElement.removeChild(activePopup)
  }
  activePopup = null
  activeAnchor = null
}
