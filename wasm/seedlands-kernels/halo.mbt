///|
pub fn fill_halo(
  columns : Int,
  known : Int,
  halo : Int,
  fluid : Int,
  oy : Int,
) -> UInt {
  let mut revision = 2166136261U
  for y = 0; y < 34; y = y + 1 {
    for z = 0; z < 34; z = z + 1 {
      for x = 0; x < 34; x = x + 1 {
        let index = x + 34 * (z + 34 * y)
        let packed = load_u32(known + index * 4)
        let value = if packed == 0xffffffffU {
          column_voxel(columns, 40, x, oy + y, z)
        } else {
          packed & 65535U
        }
        let level = if packed == 0xffffffffU {
          if value == 8U {
            0x88U
          } else {
            0U
          }
        } else {
          packed >> 16
        }
        store_u16(halo + index * 2, value)
        store_u8(fluid + index, level)
        revision = (revision ^ value) * 16777619U
      }
    }
  }
  revision
}
