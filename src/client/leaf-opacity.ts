/** 周期轮廓与镜像彩色瓦片共用128像素周期，避免格状孔洞和接缝。 */
export function leafOpacity(x: number, y: number, brightness: number) {
  if (brightness < 25) return 0;
  const u = ((((x % 128) + 128) % 128) * Math.PI * 2) / 128;
  const v = ((((y % 128) + 128) % 128) * Math.PI * 2) / 128;
  const field = Math.sin(u * 3 + Math.sin(v * 2) * 0.7) * Math.cos(v * 4 + 0.4) + 0.35 * Math.sin(u * 7 + v * 5);
  const gap = Math.max(0, Math.min(1, (field - 0.4) / 0.25));
  return Math.round(255 * (1 - gap * gap * (3 - 2 * gap)));
}
