///|
#inline
fn column_voxel(input : Int, grid : Int, x : Int, y : Int, z : Int) -> UInt {
  let column = input + (x + 3 + grid * (z + 3)) * 16
  let height = load_u32(column).reinterpret_as_int()
  let kind = load_u32(column + 4)
  let water_level = load_u32(column + 8).reinterpret_as_int()
  if y > height && y <= water_level {
    return 8U
  }
  if y <= height {
    if y == height {
      return if kind == 3U {
        6U
      } else if kind == 4U {
        7U
      } else if kind == 2U {
        3U
      } else {
        1U
      }
    }
    return if y > height - 4 {
      if kind == 3U {
        6U
      } else if kind == 2U {
        3U
      } else {
        2U
      }
    } else {
      3U
    }
  }
  for tx = x; tx <= x + 6; tx = tx + 1 {
    for tz = z; tz <= z + 6; tz = tz + 1 {
      let tree_column = input + (tx + grid * tz) * 16
      if load_u32(tree_column + 12) == 0U {
        continue
      }
      let th = load_u32(tree_column).reinterpret_as_int()
      let dx = (x + 3 - tx).abs()
      let dz = (z + 3 - tz).abs()
      if dx == 0 && dz == 0 && y > th && y <= th + 4 {
        return 4U
      }
      if dx <= 2 &&
        dz <= 2 &&
        y >= th + 3 &&
        y <= th + 6 &&
        (dx + dz < 4 || y >= th + 5) {
        return 5U
      }
    }
  }
  0U
}

///|
pub fn fill_chunk(input : Int, output : Int, oy : Int) -> Int {
  for z = 0; z < 32; z = z + 1 {
    for x = 0; x < 32; x = x + 1 {
      for y = 0; y < 32; y = y + 1 {
        store_u16(
          output + (x + 32 * (z + 32 * y)) * 2,
          column_voxel(input, 38, x, oy + y, z),
        )
      }
    }
  }
  0
}
