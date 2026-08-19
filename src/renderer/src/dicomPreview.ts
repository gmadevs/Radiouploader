/**
 * Painting only. Decoding happens in the main process, which reads a single
 * frame's byte range instead of moving a whole DICOM file across the bridge.
 */
export async function renderSlice(filePath: string, frame: number, canvas: HTMLCanvasElement): Promise<void> {
  const { width, height, rgba } = await window.api.readPreviewFrame(filePath, frame)

  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D context')
  // The bridge hands back a plain array-like; ImageData needs a clamped array.
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
}
