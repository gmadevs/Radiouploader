import { describe, expect, it } from 'vitest'
import { describeError, stated, unwrap } from './errorText'

describe('unwrap', () => {
  it('takes off the channel the bridge wrapped the error in', () => {
    expect(
      unwrap(new Error("Error invoking remote method 'api:draftCases': Error: Something specific happened"))
    ).toBe('Something specific happened')
  })

  it('leaves a message that was never wrapped alone', () => {
    expect(unwrap(new Error('No stacks selected'))).toBe('No stacks selected')
  })

  it('reads something that is not an Error at all', () => {
    expect(unwrap('plain string')).toBe('plain string')
  })
})

describe('describeError', () => {
  it('names the missing credentials and offers where to put them', () => {
    const shown = describeError(
      new Error(
        "Error invoking remote method 'api:draftCases': Error: Radiopaedia application credentials are not configured yet"
      )
    )
    expect(shown.title).toBe("Radiopaedia credentials aren't set yet")
    expect(shown.fix).toBe('credentials')
    // The channel is this codebase's business, not the reader's.
    expect(JSON.stringify(shown)).not.toContain('api:draftCases')
  })

  it('offers a sign-in on an expired session', () => {
    expect(describeError(new Error('Session expired — please sign in again')).fix).toBe('signIn')
    expect(describeError(new Error('Not signed in to Radiopaedia')).fix).toBe('signIn')
  })

  it('says the site could not be reached, without guessing what got through', () => {
    const shown = describeError(new Error('fetch failed'))
    expect(shown.title).toBe("Couldn't reach radiopaedia.org")
    expect(shown.fix).toBeNull()
  })

  it('says a stopped upload left a draft, before calling it a connection problem', () => {
    const shown = describeError(
      new Error("Error invoking remote method 'upload:run': Error: Upload stopped partway: fetch failed")
    )
    expect(shown.title).toBe('The upload stopped partway')
    expect(shown.detail).toContain('fetch failed')
    expect(shown.detail).toContain('carry on in that case')
  })

  it('shows an unrecognised message as it was thrown', () => {
    const shown = describeError(new Error("Error invoking remote method 'api:upload': Error: No studies to upload"))
    expect(shown).toEqual({ title: 'No studies to upload', detail: null, fix: null })
  })

  it('has something to say even about an empty throw', () => {
    expect(describeError(new Error('')).title).toBe('Something went wrong')
  })
})

describe('stated', () => {
  it('carries no fix, since nothing threw', () => {
    expect(stated('No readable DICOM files found')).toEqual({
      title: 'No readable DICOM files found',
      detail: null,
      fix: null
    })
  })
})
