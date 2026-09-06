///|
const ARENA_START = 64

///|
const ARENA_LIMIT = 16777216

///|
pub fn occupancy(input : Int, output : Int, count : Int) -> Int {
  if input < ARENA_START || output < ARENA_START || count < 0 || input % 2 != 0 {
    return 1
  }
  if input > ARENA_LIMIT || output > ARENA_LIMIT {
    return 1
  }
  if count > (ARENA_LIMIT - input) / 2 || count > ARENA_LIMIT - output {
    return 1
  }
  for index = 0; index < count; index = index + 1 {
    let voxel = load_u16(input + index * 2)
    store_u8(output + index, if voxel == 0U || voxel == 8U { 0U } else { 1U })
  }
  0
}
