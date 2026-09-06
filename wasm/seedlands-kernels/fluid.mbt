///|
#inline
fn fluid_i32(offset : Int) -> Int {
  load_u32(offset).reinterpret_as_int()
}

///|
#inline
fn fluid_chunk_coord(value : Int) -> Int {
  if value < 0 {
    (value - 31) / 32
  } else {
    value / 32
  }
}

///|
#inline
fn fluid_address(x : Int, y : Int, z : Int) -> (Int, Int) {
  let cx = fluid_chunk_coord(x)
  let cy = fluid_chunk_coord(y)
  let cz = fluid_chunk_coord(z)
  for index = 0; index < fluid_i32(64); index = index + 1 {
    let row = 1024 + index * 20
    if fluid_i32(row) == cx &&
      fluid_i32(row + 4) == cy &&
      fluid_i32(row + 8) == cz {
      let local_index = x - cx * 32 + 32 * (z - cz * 32 + 32 * (y - cy * 32))
      return (
        fluid_i32(row + 12) + local_index * 2,
        fluid_i32(row + 16) + local_index,
      )
    }
  }
  store_u32(68, load_u32(68) + 1U)
  (-1, -1)
}

///|
#inline
fn fluid_cell(x : Int, y : Int, z : Int) -> Int {
  let (voxel_ptr, fluid_ptr) = fluid_address(x, y, z)
  if voxel_ptr < 0 {
    return -1
  }
  let voxel = load_u16(voxel_ptr)
  let fluid = load_u8(fluid_ptr)
  let level = if voxel == 8U && fluid == 0U { 0x88U } else { fluid }
  (voxel | (level << 16)).reinterpret_as_int()
}

///|
#inline
fn fluid_water(value : Int) -> Bool {
  value >= 0 && (value & 65535) == 8
}

///|
#inline
fn fluid_level(value : Int) -> Int {
  (value >> 16) & 15
}

///|
#inline
fn fluid_activate(x : Int, y : Int, z : Int) -> Unit {
  if y < 0 || y > 63 {
    return
  }
  let count = fluid_i32(76)
  if count >= 16384 {
    store_u32(80, 1U)
    return
  }
  let row = 5242880 + count * 12
  store_u32(row, x.reinterpret_as_uint())
  store_u32(row + 4, y.reinterpret_as_uint())
  store_u32(row + 8, z.reinterpret_as_uint())
  store_u32(76, (count + 1).reinterpret_as_uint())
}

///|
#inline
fn fluid_neighborhood(x : Int, y : Int, z : Int) -> Unit {
  fluid_activate(x, y, z)
  fluid_activate(x, y - 1, z)
  fluid_activate(x, y + 1, z)
  fluid_activate(x - 1, y, z)
  fluid_activate(x + 1, y, z)
  fluid_activate(x, y, z - 1)
  fluid_activate(x, y, z + 1)
}

///|
#inline
fn fluid_write(x : Int, y : Int, z : Int, voxel : UInt, fluid : UInt) -> Unit {
  let (voxel_ptr, fluid_ptr) = fluid_address(x, y, z)
  if voxel_ptr < 0 {
    return
  }
  let count = fluid_i32(72)
  let mut seen = false
  for index = 0; index < count; index = index + 1 {
    if fluid_i32(4194304 + index * 24 + 16) == voxel_ptr {
      seen = true
      break
    }
  }
  if !seen {
    if count >= 2048 {
      store_u32(80, 1U)
      return
    }
    let row = 4194304 + count * 24
    store_u32(row, x.reinterpret_as_uint())
    store_u32(row + 4, y.reinterpret_as_uint())
    store_u32(row + 8, z.reinterpret_as_uint())
    store_u32(row + 12, load_u16(voxel_ptr) | (load_u8(fluid_ptr) << 16))
    store_u32(row + 16, voxel_ptr.reinterpret_as_uint())
    store_u32(row + 20, fluid_ptr.reinterpret_as_uint())
    store_u32(72, (count + 1).reinterpret_as_uint())
  }
  store_u16(voxel_ptr, voxel)
  store_u8(fluid_ptr, fluid)
}

///|
#inline
fn fluid_place(x : Int, y : Int, z : Int, level : Int) -> Unit {
  let (voxel_ptr, fluid_ptr) = fluid_address(x, y, z)
  if voxel_ptr < 0 {
    return
  }
  let voxel = load_u16(voxel_ptr)
  if voxel != 0U && voxel != 8U {
    return
  }
  let next = (if level < 1 { 1 } else if level > 8 { 8 } else { level }).reinterpret_as_uint()
  if voxel == 8U && load_u8(fluid_ptr) == next {
    return
  }
  fluid_write(x, y, z, 8U, next)
  fluid_neighborhood(x, y, z)
}

///|
#inline
fn fluid_side(x : Int, z : Int, direction : Int) -> (Int, Int) {
  if direction == 0 {
    (x - 1, z)
  } else if direction == 1 {
    (x + 1, z)
  } else if direction == 2 {
    (x, z - 1)
  } else {
    (x, z + 1)
  }
}

///|
pub fn fluid_candidate(count : Int) -> Int {
  if count < 0 || count > 192 || fluid_i32(64) < 0 || fluid_i32(64) > 32 {
    return 1
  }
  for index = 0; index < count; index = index + 1 {
    let row = 8192 + index * 12
    let x = fluid_i32(row)
    let y = fluid_i32(row + 4)
    let z = fluid_i32(row + 8)
    let current = fluid_cell(x, y, z)
    if !fluid_water(current) {
      continue
    }
    let level = fluid_level(current)
    let source = (current & 0x800000) != 0
    if !source {
      let unknown_before = load_u32(68)
      let above = fluid_cell(x, y + 1, z)
      let mut desired = 0
      if fluid_water(above) {
        desired = 8
      } else {
        for direction = 0; direction < 4; direction = direction + 1 {
          let (sx, sz) = fluid_side(x, z, direction)
          let neighbor = fluid_cell(sx, y, sz)
          if fluid_water(neighbor) && fluid_level(neighbor) - 1 > desired {
            desired = fluid_level(neighbor) - 1
          }
        }
      }
      let above_again = fluid_cell(x, y + 1, z)
      let mut stronger = false
      for direction = 0; direction < 4; direction = direction + 1 {
        let (sx, sz) = fluid_side(x, z, direction)
        let neighbor = fluid_cell(sx, y, sz)
        if fluid_water(neighbor) && fluid_level(neighbor) > level {
          stronger = true
          break
        }
      }
      if !fluid_water(above_again) && !stronger && desired > level - 1 {
        desired = level - 1
      }
      if desired < level && unknown_before != load_u32(68) {
        fluid_activate(x, y, z)
        continue
      }
      if desired <= 0 {
        fluid_write(x, y, z, 0U, 0U)
        fluid_neighborhood(x, y, z)
        continue
      }
      if desired != level {
        fluid_write(x, y, z, 8U, desired.reinterpret_as_uint())
        fluid_neighborhood(x, y, z)
      }
    }
    let below = fluid_cell(x, y - 1, z)
    if below < 0 {
      continue
    }
    if (below & 65535) == 0 {
      fluid_place(x, y - 1, z, 8)
      fluid_activate(x, y, z)
      continue
    }
    if fluid_water(below) {
      continue
    }
    let settled = fluid_cell(x, y, z)
    let settled_level = if settled < 0 { 0 } else { fluid_level(settled) }
    if settled_level <= 1 {
      continue
    }
    for direction = 0; direction < 4; direction = direction + 1 {
      let (sx, sz) = fluid_side(x, z, direction)
      let target = fluid_cell(sx, y, sz)
      if target < 0 {
        continue
      }
      if (target & 65535) == 0 ||
        (
          fluid_water(target) &&
          (target & 0x800000) == 0 &&
          fluid_level(target) < settled_level - 1
        ) {
        fluid_place(sx, y, sz, settled_level - 1)
      }
    }
  }
  fluid_i32(80)
}
