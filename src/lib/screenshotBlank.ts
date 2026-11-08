/**
 * "Is this screenshot empty?" — an all-black picture on an Android mirror means
 * the app blocks capture (FLAG_SECURE), the display is off, or the virtual
 * display never composed a frame. Telling that apart from "still loading" needs
 * the pixels, so this samples them.
 *
 * Returns null when the environment cannot decode images (jsdom, no canvas).
 * Callers must treat null as "unknown", never as "not blank": a lock screen and
 * an unrendered page look identical in the tree, and guessing wrong either
 * stops a healthy run or burns steps on a black screen.
 */
export const BLANK_LUMINANCE = 8
export const BLANK_RATIO = 0.98
export const BLANK_SAMPLE_SIDE = 32

/** Pixels below this luminance count as empty. */
function isDark(data: Uint8ClampedArray, offset: number) {
  const luminance = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]
  return luminance < BLANK_LUMINANCE
}

export async function looksBlankScreenshot(
  dataUrl: string | undefined,
): Promise<boolean | null> {
  if (!dataUrl || typeof createImageBitmap !== 'function') {
    return null
  }
  const canvasFactory = () => {
    if (typeof OffscreenCanvas === 'function') {
      return new OffscreenCanvas(BLANK_SAMPLE_SIDE, BLANK_SAMPLE_SIDE)
    }
    if (typeof document === 'undefined') {
      return null
    }
    const canvas = document.createElement('canvas')
    canvas.width = BLANK_SAMPLE_SIDE
    canvas.height = BLANK_SAMPLE_SIDE
    return canvas
  }

  try {
    const response = await fetch(dataUrl)
    const bitmap = await createImageBitmap(await response.blob())
    try {
      const canvas = canvasFactory()
      if (!canvas) {
        return null
      }
      const context = canvas.getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null
      if (!context) {
        return null
      }
      context.drawImage(bitmap, 0, 0, BLANK_SAMPLE_SIDE, BLANK_SAMPLE_SIDE)
      const { data } = context.getImageData(0, 0, BLANK_SAMPLE_SIDE, BLANK_SAMPLE_SIDE)
      let dark = 0
      const pixels = data.length / 4
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] === 0 || isDark(data, index)) {
          dark += 1
        }
      }
      return dark / pixels >= BLANK_RATIO
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}
