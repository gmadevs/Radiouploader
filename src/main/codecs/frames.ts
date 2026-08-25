import dicomParser from 'dicom-parser'

/**
 * Finding one frame inside compressed pixel data.
 *
 * A frame of an encapsulated object cannot be addressed arithmetically the way
 * plain samples can: frames are fragments, and which fragment a frame starts at
 * is written in the basic offset table inside the pixel data element. Both the
 * preview and the anonymiser need the same answer, so they ask here.
 */
export function encodedFrame(
  dataSet: dicomParser.DataSet,
  frame: number,
  frames: number
): Uint8Array {
  const element = dataSet.elements.x7fe00010
  if (!element?.fragments?.length) throw new Error('This file has no compressed pixel data to read')

  // A single-frame object owns every fragment, however many it was split into.
  if (frames <= 1) {
    return dicomParser.readEncapsulatedPixelDataFromFragments(dataSet, element, 0, element.fragments.length)
  }

  const offsets = element.basicOffsetTable ?? []
  if (offsets.length > frame) {
    return dicomParser.readEncapsulatedImageFrame(dataSet, element, frame)
  }
  // No offset table. One fragment per frame is the common way to write that,
  // and for the JPEG family the frame starts can be recovered from the SOI
  // markers instead. Anything else is guesswork, so it says so.
  if (element.fragments.length === frames) {
    return dicomParser.readEncapsulatedPixelDataFromFragments(dataSet, element, frame)
  }
  const scanned = dicomParser.createJPEGBasicOffsetTable(dataSet, element)
  if (scanned.length > frame) {
    return dicomParser.readEncapsulatedImageFrame(dataSet, element, frame, scanned)
  }
  throw new Error(`Cannot tell where frame ${frame + 1} starts: this file has no basic offset table`)
}
