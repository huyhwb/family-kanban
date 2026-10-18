/**
 * 头像上传前在客户端做居中裁切 + 缩放，降低传输体积与服务端压力。
 * 输出 256×256（webp 优先，不支持时回退 png）。
 */
export async function resizeAvatar(file, size = 256) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'

  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)

  const tryBlob = (type, quality) =>
    new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality)
    })

  let blob = await tryBlob('image/webp', 0.9)
  if (!blob) blob = await tryBlob('image/png', 1)
  if (!blob) throw new Error('图片处理失败，请换一张试试')

  const ext = blob.type === 'image/webp' ? 'webp' : 'png'
  return new File([blob], `avatar.${ext}`, { type: blob.type })
}
