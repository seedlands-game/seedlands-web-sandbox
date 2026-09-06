///|
/// 描述符 arena 与 MoonBit heap 分离；合法的完整 MeshData 可能超过 16MiB。
const MESH_ARENA_START = 64

///|
const MESH_ARENA_LIMIT = 16777216

///|
const HALO_SIZE = 36

///|
const HALO_CELLS = 46656

///|
const MASK_BYTES = 6144

///|
const RECORD_BYTES = 16

///|
/// 每个 mask cell 最多发射一个描述符，另加每个 canonical 格一个灯笼。
const MAX_DESCRIPTOR_RECORDS : Int = 3 * 33 * 32 * 32 + 32 * 32 * 32

///|
const MAX_DESCRIPTOR_BYTES : Int = MAX_DESCRIPTOR_RECORDS * RECORD_BYTES

///|
#inline
fn halo_index(x : Int, y : Int, z : Int) -> Int {
  x + 2 + HALO_SIZE * (z + 2 + HALO_SIZE * (y + 2))
}

///|
#inline
fn sample(halo : Int, x : Int, y : Int, z : Int) -> UInt {
  load_u16(halo + halo_index(x, y, z) * 2)
}

///|
#inline
fn sample_fluid(fluid : Int, x : Int, y : Int, z : Int) -> UInt {
  load_u8(fluid + halo_index(x, y, z))
}

///|
#inline
fn greedy(id : UInt) -> Bool {
  id != 0U && id != 10U
}

///|
#inline
fn occludes(id : UInt) -> Bool {
  id != 0U && id != 8U && id != 10U
}

///|
#inline
fn visible(source : UInt, target : UInt) -> Bool {
  if !greedy(source) {
    return false
  }
  if source == 8U {
    target == 0U || (target != 8U && !occludes(target))
  } else {
    target == 0U || target == 8U || !occludes(target)
  }
}

///|
/// 返回既有 TypeScript 材质号；255 保留 undefined-id 路径。
#inline
fn material(id : UInt, axis : Int, positive : Bool) -> UInt {
  if id == 1U {
    return if axis == 1 { if positive { 1U } else { 3U } } else { 2U }
  }
  if id == 4U {
    return if axis == 1 { 7U } else { 6U }
  }
  if id == 2U {
    return 3U
  }
  if id == 3U {
    return 4U
  }
  if id == 5U {
    return 8U
  }
  if id == 6U {
    return 5U
  }
  if id == 7U {
    return 9U
  }
  if id == 8U {
    return 10U
  }
  if id == 9U {
    return 11U
  }
  if id == 10U {
    return 12U
  }
  255U
}

///|
/// 单调编码水高：1..8 为 1/8..7/8，9 表示被水覆盖的满格。
#inline
fn water_height_code(
  halo : Int,
  fluid : Int,
  x : Int,
  y : Int,
  z : Int,
) -> UInt {
  if sample(halo, x, y + 1, z) == 8U {
    return 9U
  }
  let mut level = sample_fluid(fluid, x, y, z) & 15U
  if level < 1U {
    level = 1U
  }
  if level > 8U {
    level = 8U
  }
  if level >= 7U {
    8U
  } else {
    level
  }
}

///|
#inline
fn packed_ao(
  halo : Int,
  bx : Int,
  by : Int,
  bz : Int,
  axis : Int,
  back : Bool,
) -> UInt {
  let normal = if back { -1 } else { 1 }
  let u = (axis + 1) % 3
  let v = (axis + 2) % 3
  let ox = if axis == 0 { bx + normal } else { bx }
  let oy = if axis == 1 { by + normal } else { by }
  let oz = if axis == 2 { bz + normal } else { bz }
  let mut packed = 0U
  for corner = 0; corner < 4; corner = corner + 1 {
    let su = if back {
      if corner < 2 {
        -1
      } else {
        1
      }
    } else if corner == 0 || corner == 3 {
      -1
    } else {
      1
    }
    let sv = if back {
      if corner == 0 || corner == 3 {
        -1
      } else {
        1
      }
    } else if corner < 2 {
      -1
    } else {
      1
    }
    let ux = if u == 0 { ox + su } else { ox }
    let uy = if u == 1 { oy + su } else { oy }
    let uz = if u == 2 { oz + su } else { oz }
    let vx = if v == 0 { ox + sv } else { ox }
    let vy = if v == 1 { oy + sv } else { oy }
    let vz = if v == 2 { oz + sv } else { oz }
    let cx = if u == 0 { ox + su } else if v == 0 { ox + sv } else { ox }
    let cy = if u == 1 { oy + su } else if v == 1 { oy + sv } else { oy }
    let cz = if u == 2 { oz + su } else if v == 2 { oz + sv } else { oz }
    let occupied_u = occludes(sample(halo, ux, uy, uz))
    let occupied_v = occludes(sample(halo, vx, vy, vz))
    let level = if occupied_u && occupied_v {
      3U
    } else {
      (if occupied_u { 1U } else { 0U }) +
      (if occupied_v { 1U } else { 0U }) +
      (if occludes(sample(halo, cx, cy, cz)) { 1U } else { 0U })
    }
    packed = packed | (level << (corner * 2))
  }
  packed
}

///|
#inline
fn mask_offset(base : Int, index : Int) -> Int {
  base + index * 6
}

///|
#inline
fn write_mask(
  base : Int,
  index : Int,
  mat : UInt,
  back : Bool,
  ao : UInt,
  high : UInt,
  low : UInt,
) -> Unit {
  let offset = mask_offset(base, index)
  store_u8(offset, 1U)
  store_u8(offset + 1, mat)
  store_u8(offset + 2, if back { 1U } else { 0U })
  store_u8(offset + 3, ao)
  store_u8(offset + 4, high)
  store_u8(offset + 5, low)
}

///|
#inline
fn same_mask(
  base : Int,
  index : Int,
  mat : UInt,
  back : Bool,
  ao : UInt,
  high : UInt,
  low : UInt,
) -> Bool {
  let offset = mask_offset(base, index)
  load_u8(offset) != 0U &&
  load_u8(offset + 1) == mat &&
  load_u8(offset + 2) == (if back { 1U } else { 0U }) &&
  load_u8(offset + 3) == ao &&
  load_u8(offset + 4) == high &&
  load_u8(offset + 5) == low
}

///|
#inline
fn clear_mask(base : Int, index : Int) -> Unit {
  store_u8(mask_offset(base, index), 0U)
}

///|
fn write_quad(
  base : Int,
  count : Int,
  mat : UInt,
  axis : Int,
  back : Bool,
  x : Int,
  y : Int,
  z : Int,
  width : Int,
  height : Int,
  ao : UInt,
  high : UInt,
  low : UInt,
) -> Unit {
  let offset = base + MASK_BYTES + count * RECORD_BYTES
  store_u8(offset, 0U)
  store_u8(offset + 1, mat)
  store_u8(offset + 2, axis.to_uint())
  store_u8(offset + 3, if back { 1U } else { 0U })
  store_u8(offset + 4, x.to_uint())
  store_u8(offset + 5, y.to_uint())
  store_u8(offset + 6, z.to_uint())
  store_u8(offset + 7, width.to_uint())
  store_u8(offset + 8, height.to_uint())
  store_u8(offset + 9, ao)
  store_u8(offset + 10, high)
  store_u8(offset + 11, low)
  store_u32(offset + 12, 0U)
}

///|
fn write_lantern(base : Int, count : Int, x : Int, y : Int, z : Int) -> Unit {
  let offset = base + MASK_BYTES + count * RECORD_BYTES
  store_u8(offset, 1U)
  store_u8(offset + 1, x.to_uint())
  store_u8(offset + 2, y.to_uint())
  store_u8(offset + 3, z.to_uint())
  store_u32(offset + 4, 0U)
  store_u32(offset + 8, 0U)
  store_u32(offset + 12, 0U)
}

///|
fn descriptor_pass(halo : Int, fluid : Int, output : Int, write : Bool) -> Int {
  let mask = output
  let mut count = 0
  for axis = 0; axis < 3; axis = axis + 1 {
    for slice = -1; slice < 32; slice = slice + 1 {
      let mut m = 0
      for j = 0; j < 32; j = j + 1 {
        for i = 0; i < 32; i = i + 1 {
          let x = if axis == 0 { slice } else if axis == 1 { j } else { i }
          let y = if axis == 0 { i } else if axis == 1 { slice } else { j }
          let z = if axis == 0 { j } else if axis == 1 { i } else { slice }
          let nx = if axis == 0 { slice + 1 } else { x }
          let ny = if axis == 1 { slice + 1 } else { y }
          let nz = if axis == 2 { slice + 1 } else { z }
          let a = sample(halo, x, y, z)
          let b = sample(halo, nx, ny, nz)
          let ah = if a == 8U {
            water_height_code(halo, fluid, x, y, z)
          } else {
            0U
          }
          let bh = if b == 8U {
            water_height_code(halo, fluid, nx, ny, nz)
          } else {
            0U
          }
          let stepped = axis != 1 && a == 8U && b == 8U && ah != bh
          let forward = if stepped { ah > bh } else { visible(a, b) }
          let back = if stepped { bh > ah } else { !forward && visible(b, a) }
          if !forward && !back {
            clear_mask(mask, m)
          } else {
            let id = if back { b } else { a }
            let bx = if back { nx } else { x }
            let by = if back { ny } else { y }
            let bz = if back { nz } else { z }
            let ao = if id == 8U {
              0U
            } else {
              packed_ao(halo, bx, by, bz, axis, back)
            }
            let high = if id == 8U {
              if stepped {
                if ah > bh {
                  ah
                } else {
                  bh
                }
              } else if back {
                bh
              } else {
                ah
              }
            } else {
              0U
            }
            let low = if stepped { if ah < bh { ah } else { bh } } else { 0U }
            write_mask(mask, m, material(id, axis, !back), back, ao, high, low)
          }
          m = m + 1
        }
      }
      m = 0
      for j = 0; j < 32; j = j + 1 {
        let mut i = 0
        while i < 32 {
          let offset = mask_offset(mask, m)
          if load_u8(offset) == 0U {
            i = i + 1
            m = m + 1
          } else {
            let mat = load_u8(offset + 1)
            let back = load_u8(offset + 2) != 0U
            let ao = load_u8(offset + 3)
            let high = load_u8(offset + 4)
            let low = load_u8(offset + 5)
            let mut width = 1
            while i + width < 32 &&
                  same_mask(mask, m + width, mat, back, ao, high, low) {
              width = width + 1
            }
            let mut height = 1
            let mut keep = true
            while j + height < 32 && keep {
              for column = 0; column < width; column = column + 1 {
                if !same_mask(
                    mask,
                    m + column + height * 32,
                    mat,
                    back,
                    ao,
                    high,
                    low,
                  ) {
                  keep = false
                }
              }
              if keep {
                height = height + 1
              }
            }
            let px = if axis == 0 {
              slice + 1
            } else if axis == 1 {
              j
            } else {
              i
            }
            let py = if axis == 0 {
              i
            } else if axis == 1 {
              slice + 1
            } else {
              j
            }
            let pz = if axis == 0 {
              j
            } else if axis == 1 {
              i
            } else {
              slice + 1
            }
            if write {
              write_quad(
                output, count, mat, axis, back, px, py, pz, width, height, ao, high,
                low,
              )
            }
            for row = 0; row < height; row = row + 1 {
              for column = 0; column < width; column = column + 1 {
                clear_mask(mask, m + column + row * 32)
              }
            }
            count = count + 1
            i = i + width
            m = m + width
          }
        }
      }
    }
  }
  for y = 0; y < 32; y = y + 1 {
    for z = 0; z < 32; z = z + 1 {
      for x = 0; x < 32; x = x + 1 {
        if sample(halo, x, y, z) == 10U {
          if write {
            write_lantern(output, count, x, y, z)
          }
          count = count + 1
        }
      }
    }
  }
  count
}

///|
/// 返回描述符字节数；-1 是非法或重叠 ABI 范围，-2 是容量不足且不写描述符。
pub fn mesh_describe(
  halo : Int,
  fluid : Int,
  output : Int,
  capacity : Int,
) -> Int {
  if halo < MESH_ARENA_START ||
    fluid < MESH_ARENA_START ||
    output < MESH_ARENA_START ||
    halo % 2 != 0 ||
    capacity < 0 {
    return -1
  }
  if halo > MESH_ARENA_LIMIT - HALO_CELLS * 2 ||
    fluid > MESH_ARENA_LIMIT - HALO_CELLS ||
    output > MESH_ARENA_LIMIT - MASK_BYTES {
    return -1
  }
  if capacity > MESH_ARENA_LIMIT - output - MASK_BYTES {
    return -1
  }
  if !(output + MASK_BYTES <= halo || output >= halo + HALO_CELLS * 2) {
    return -1
  }
  if !(output + MASK_BYTES <= fluid || output >= fluid + HALO_CELLS) {
    return -1
  }
  // 调用方提供完整 arena 时，上述静态上界已经证明写入不会越界；直接写入
  // 保持结果次序，同时避免为容量检查重复整次 greedy 扫描。较小 capacity
  // 仍维持原来的计数后写入事务语义，绝不留下部分输出。
  if capacity >= MAX_DESCRIPTOR_BYTES {
    return descriptor_pass(halo, fluid, output, true) * RECORD_BYTES
  }
  let count = descriptor_pass(halo, fluid, output, false)
  if count > capacity / RECORD_BYTES {
    return -2
  }
  descriptor_pass(halo, fluid, output, true) * RECORD_BYTES
}
