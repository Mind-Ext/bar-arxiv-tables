import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  destroyCitationPopup,
  findBibliographyTarget,
  hideCitationPopup,
  initCitationPopup,
  showCitationPopup,
} from '../src/extra/citationPopup'

describe('arXiv Citation Popup', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    destroyCitationPopup()
  })

  afterEach(() => {
    destroyCitationPopup()
    document.body.innerHTML = ''
  })

  it('finds bibliography target element by anchor href', () => {
    const bibItem = document.createElement('li')
    bibItem.id = 'bib.bib1'
    bibItem.textContent = 'Vaswani et al., Attention is all you need, 2017.'
    document.body.appendChild(bibItem)

    const link = document.createElement('a')
    link.setAttribute('href', '#bib.bib1')
    document.body.appendChild(link)

    const found = findBibliographyTarget(link)
    expect(found).toBe(bibItem)
  })

  it('handles URL encoded hrefs gracefully', () => {
    const bibItem = document.createElement('div')
    bibItem.id = 'bib:special-key'
    bibItem.textContent = 'Special citation content'
    document.body.appendChild(bibItem)

    const link = document.createElement('a')
    link.setAttribute('href', '#bib%3Aspecial-key')
    document.body.appendChild(link)

    const found = findBibliographyTarget(link)
    expect(found).toBe(bibItem)
  })

  it('returns null when target element is missing or href invalid', () => {
    const link = document.createElement('a')
    link.setAttribute('href', '#nonexistent')
    expect(findBibliographyTarget(link)).toBeNull()

    const extLink = document.createElement('a')
    extLink.setAttribute('href', 'https://arxiv.org')
    expect(findBibliographyTarget(extLink)).toBeNull()
  })

  it('shows popup with cloned content on click and prevents default', () => {
    initCitationPopup()

    const bibItem = document.createElement('li')
    bibItem.id = 'bib.bib2'
    bibItem.innerHTML =
      '<strong>Devlin et al.</strong> BERT: Pre-training, 2018.'
    document.body.appendChild(bibItem)

    const link = document.createElement('a')
    link.setAttribute('href', '#bib.bib2')
    link.className = 'ltx_ref'
    link.textContent = '[2]'
    document.body.appendChild(link)

    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault')
    link.dispatchEvent(clickEvent)

    expect(preventDefaultSpy).toHaveBeenCalled()

    const popup = document.getElementById('arxiv-citation-popup')
    expect(popup).not.toBeNull()
    expect(popup?.style.display).toBe('block')
    expect(popup?.innerHTML).toContain('BERT: Pre-training')
    expect(popup?.innerHTML).toContain('Devlin et al.')
  })

  it('does not intercept click when modifier key is pressed', () => {
    initCitationPopup()

    const bibItem = document.createElement('li')
    bibItem.id = 'bib.bib3'
    bibItem.textContent = 'Some reference'
    document.body.appendChild(bibItem)

    const link = document.createElement('a')
    link.setAttribute('href', '#bib.bib3')
    document.body.appendChild(link)

    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      button: 0,
    })
    const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault')
    link.dispatchEvent(clickEvent)

    expect(preventDefaultSpy).not.toHaveBeenCalled()
    const popup = document.getElementById('arxiv-citation-popup')
    expect(popup).toBeNull()
  })

  it('toggles popup off when clicking the same active citation link again', () => {
    initCitationPopup()

    const bibItem = document.createElement('li')
    bibItem.id = 'bib.bib4'
    bibItem.textContent = 'Reference content'
    document.body.appendChild(bibItem)

    const link = document.createElement('a')
    link.setAttribute('href', '#bib.bib4')
    document.body.appendChild(link)

    // First click -> open
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const popup = document.getElementById('arxiv-citation-popup')
    expect(popup?.style.display).toBe('block')

    // Second click -> close
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(popup?.style.display).toBe('none')
  })

  it('hides popup when clicking outside', () => {
    initCitationPopup()

    const bibItem = document.createElement('li')
    bibItem.id = 'bib.bib5'
    bibItem.textContent = 'Reference content'
    document.body.appendChild(bibItem)

    const link = document.createElement('a')
    link.setAttribute('href', '#bib.bib5')
    document.body.appendChild(link)

    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const popup = document.getElementById('arxiv-citation-popup')
    expect(popup?.style.display).toBe('block')

    // Click outside
    document.body.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(popup?.style.display).toBe('none')
  })

  it('hides popup when Escape is pressed', () => {
    initCitationPopup()

    const bibItem = document.createElement('li')
    bibItem.id = 'bib.bib6'
    bibItem.textContent = 'Reference content'
    document.body.appendChild(bibItem)

    const link = document.createElement('a')
    link.setAttribute('href', '#bib.bib6')
    document.body.appendChild(link)

    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const popup = document.getElementById('arxiv-citation-popup')
    expect(popup?.style.display).toBe('block')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(popup?.style.display).toBe('none')
  })

  it('cleans up DOM and listeners on destroyCitationPopup', () => {
    initCitationPopup()

    const bibItem = document.createElement('li')
    bibItem.id = 'bib.bib7'
    bibItem.textContent = 'Reference content'
    document.body.appendChild(bibItem)

    const link = document.createElement('a')
    link.setAttribute('href', '#bib.bib7')
    document.body.appendChild(link)

    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(document.getElementById('arxiv-citation-popup')).not.toBeNull()

    destroyCitationPopup()
    expect(document.getElementById('arxiv-citation-popup')).toBeNull()

    // Subsequent clicks should do nothing
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(document.getElementById('arxiv-citation-popup')).toBeNull()
  })
})
