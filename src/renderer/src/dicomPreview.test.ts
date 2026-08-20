import { describe, expect, it } from 'vitest'
import { previewErrorText } from './dicomPreview'

describe('previewErrorText', () => {
  it('drops the layers Electron adds on the way out of the main process', () => {
    expect(
      previewErrorText(
        new Error(
          "Error invoking remote method 'preview:frame': UnsupportedTransferSyntaxError: JPEG baseline is not supported for preview yet"
        )
      )
    ).toBe('JPEG baseline is not supported for preview yet')
  })

  it('leaves a message that was never wrapped alone', () => {
    expect(previewErrorText(new Error('No pixel data in this file'))).toBe('No pixel data in this file')
  })

  it('reads something thrown that was not an Error', () => {
    expect(previewErrorText('ENOENT')).toBe('ENOENT')
  })
})
