import fs from 'node:fs'
import path from 'node:path'
import { app, screen, type BrowserWindow, type Rectangle } from 'electron'

/**
 * Remember where the window was, and never open it somewhere it cannot be used.
 *
 * The size is the user's to choose — some people want this filling a large
 * screen, some want it beside a PACS viewer — so the app restores what they
 * left rather than imposing a size on every launch. What it will not restore is
 * a window that no longer fits: a saved position from a monitor that has since
 * been unplugged, or a height from a large screen onto a small laptop, both put
 * the window somewhere the user cannot drag it back from.
 */

/** Comfortable on a large screen, and shrunk to fit anything smaller. */
const PREFERRED = { width: 1280, height: 860 }

/** Breathing room kept around the window when the screen is the limit. */
const MARGIN = { x: 80, y: 60 }

/** Below this the wizard's two-column rows collapse into something unusable. */
export const MINIMUM = { width: 960, height: 640 }

export interface WindowState {
  bounds?: Rectangle
  maximised?: boolean
}

/**
 * The bounds to open at, given what was saved and the screen available now.
 *
 * Pure, so the awkward cases — a monitor that has gone away, a window taller
 * than the screen — can be tested without a display.
 */
export function fitBounds(saved: Rectangle | undefined, workArea: Rectangle): Rectangle {
  const width = Math.max(
    Math.min(saved?.width ?? PREFERRED.width, workArea.width - MARGIN.x, PREFERRED.width),
    Math.min(MINIMUM.width, workArea.width)
  )
  const height = Math.max(
    Math.min(saved?.height ?? PREFERRED.height, workArea.height - MARGIN.y, PREFERRED.height),
    Math.min(MINIMUM.height, workArea.height)
  )

  // A saved position is kept only while its title bar is still reachable;
  // otherwise the window is centred on the screen it will actually appear on.
  const titleBarVisible =
    saved !== undefined &&
    saved.x + saved.width > workArea.x + 40 &&
    saved.x < workArea.x + workArea.width - 40 &&
    saved.y >= workArea.y &&
    saved.y < workArea.y + workArea.height - 40

  if (!titleBarVisible) {
    return {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
      width,
      height
    }
  }

  return {
    x: Math.min(saved.x, workArea.x + workArea.width - width),
    y: Math.min(saved.y, workArea.y + workArea.height - height),
    width,
    height
  }
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

/**
 * Read the saved state and fit it to the screen it will open on.
 *
 * Read synchronously: it is a few hundred bytes, and it is needed before the
 * window can be constructed at all.
 */
export function openingBounds(): { bounds: Rectangle; maximised: boolean } {
  let saved: WindowState = {}
  try {
    saved = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as WindowState
  } catch {
    // No state yet, or a file from a different version — open at the default.
  }

  const display = saved.bounds ? screen.getDisplayMatching(saved.bounds) : screen.getPrimaryDisplay()
  return { bounds: fitBounds(saved.bounds, display.workArea), maximised: saved.maximised === true }
}

/** Save on a timer so a drag writes once, not once per frame. */
const SAVE_DELAY = 400

/** Record what the user does to the window, so the next launch matches it. */
export function rememberWindow(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined

  const write = (): void => {
    if (win.isDestroyed()) return
    // getNormalBounds is the size to come back to when unmaximised; the maximised
    // flag carries the rest, so restoring never leaves a full-screen-sized window
    // floating loose.
    const state: WindowState = { bounds: win.getNormalBounds(), maximised: win.isMaximized() }
    try {
      fs.writeFileSync(statePath(), JSON.stringify(state, null, 2))
    } catch {
      // A read-only or full disk must not stop the app from closing.
    }
  }

  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(write, SAVE_DELAY)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => {
    clearTimeout(timer)
    write()
  })
}
