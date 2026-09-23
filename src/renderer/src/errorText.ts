/**
 * What to put on screen when something the main process did went wrong.
 *
 * Every one of these arrives over the IPC bridge, and Electron wraps whatever
 * was thrown in the name of the channel it was thrown on: the credentials
 * message reached the footer reading "Error invoking remote method
 * 'api:draftCases': Error: Radiopaedia application credentials are not
 * configured yet". The channel is a fact about this codebase, not about
 * anything the reader can act on, and the word Error twice over is not a
 * sentence anybody reads to the end.
 *
 * Kept as a plain module so the mapping can be tested without the footer.
 */

/** A fix the app can offer as a button, rather than only describe. */
export type Fix = 'credentials' | 'signIn' | null

export interface ShownError {
  /** One line saying what happened, in the words of someone using the app. */
  title: string
  /** What to do about it, where there is something true to say. */
  detail: string | null
  fix: Fix
}

/** An error the app states itself, with no exception behind it. */
export function stated(title: string, detail: string | null = null): ShownError {
  return { title, detail, fix: null }
}

/**
 * The message as it was thrown, with the bridge's wrapping taken off.
 *
 * Both layers are stripped: the channel first, then the "Error:" that the
 * wrapping puts in front of the message it carries.
 */
export function unwrap(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value)
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(Error|TypeError):\s*/, '')
    .trim()
}

/**
 * The few failures worth recognising by name.
 *
 * Anything not on this list is shown as it was thrown, unwrapped: the messages
 * the main process raises are written to be read, and inventing a friendlier
 * sentence for one of them would mean saying less than the app knows.
 */
export function describeError(value: unknown): ShownError {
  const message = unwrap(value)

  if (/credentials are not configured/i.test(message)) {
    return {
      title: "Radiopaedia credentials aren't set yet",
      detail:
        'The application ID and secret live in your account panel. Nothing can be read from the site, or sent to it, until they are there.',
      fix: 'credentials'
    }
  }

  if (/not signed in|session expired/i.test(message)) {
    return {
      title: 'Your Radiopaedia session has ended',
      detail: 'Sign in again. Nothing that has been imported or anonymised on this computer is lost.',
      fix: 'signIn'
    }
  }

  // Ahead of the network rule, which a dropped connection mid-upload would
  // otherwise meet first — and "try again" there does not say the case already
  // exists, which is what decides whether trying again makes a second one.
  const stopped = /^Upload stopped partway:\s*(.*)$/s.exec(message)
  if (stopped) {
    return {
      title: 'The upload stopped partway',
      detail:
        `${stopped[1]} — what had gone up is on Radiopaedia as a draft. ` +
        'Press Upload to Radiopaedia again to carry on in that case rather than start another.',
      fix: null
    }
  }

  // undici says "fetch failed" and keeps the reason in a cause nobody sees;
  // the codes are what a proxy or a dropped connection leaves in the message.
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(message)) {
    return {
      title: "Couldn't reach radiopaedia.org",
      detail: 'Check the connection and try again.',
      fix: null
    }
  }

  return { title: message === '' ? 'Something went wrong' : message, detail: null, fix: null }
}
