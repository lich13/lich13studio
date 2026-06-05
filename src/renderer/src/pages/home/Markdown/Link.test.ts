import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openMarkdownLinkExternally } from './Link'

describe('openMarkdownLinkExternally', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { window: any }).window = {
      api: {
        shell: {
          openExternal: vi.fn(async () => undefined)
        }
      }
    }
  })

  it('opens markdown links in the default external browser', () => {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as React.MouseEvent<HTMLAnchorElement>

    openMarkdownLinkExternally('https://cyberduck.io/', event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    expect(window.api.shell.openExternal).toHaveBeenCalledWith('https://cyberduck.io/')
  })

  it('does not intercept internal anchors', () => {
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as React.MouseEvent<HTMLAnchorElement>

    openMarkdownLinkExternally('#heading-topic', event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(window.api.shell.openExternal).not.toHaveBeenCalled()
  })
})
