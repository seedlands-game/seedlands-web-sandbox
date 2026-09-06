///|
const CODEC_VOXEL_COUNT = 32768

///|
const CODEC_ARENA_START = 64

///|
const CODEC_ARENA_LIMIT = 16777216

///|
fn valid_range(offset : Int, length : Int, width : Int) -> Bool {
  offset >= CODEC_ARENA_START &&
  length >= 0 &&
  offset % width == 0 &&
  offset <= CODEC_ARENA_LIMIT &&
  length <= (CODEC_ARENA_LIMIT - offset) / width
}

///|
fn valid_buffers(
  input : Int,
  output : Int,
  capacity : Int,
  width : Int,
) -> Bool {
  valid_range(input, CODEC_VOXEL_COUNT, width) &&
  valid_range(output, capacity, 1) &&
  capacity >= 0
}

///|
fn write_var_uint(value0 : Int, cursor0 : Int, end : Int) -> Int {
  let mut value = value0
  let mut cursor = cursor0
  for iteration = 0; iteration < 5; iteration = iteration + 1 {
    if cursor >= end {
      return -1
    }
    let byte = value & 127
    value = value >> 7
    store_u8(
      cursor,
      (if value != 0 { byte | 128 } else { byte }).reinterpret_as_uint(),
    )
    cursor = cursor + 1
    if value == 0 {
      return cursor
    }
  }
  -1
}

///|
/// Encode the exact procedural-diff-v1 payload.
pub fn encode_diff(
  input : Int,
  procedural : Int,
  output : Int,
  capacity : Int,
) -> Int {
  if !valid_buffers(input, output, capacity, 2) ||
    !valid_range(procedural, CODEC_VOXEL_COUNT, 2) {
    return -1
  }
  if capacity < 4 {
    return -2
  }
  let end = output + capacity
  store_u32(output, 0U)
  let mut count = 0
  let mut previous = 0
  let mut cursor = output + 4
  for index = 0; index < CODEC_VOXEL_COUNT; index = index + 1 {
    let value = load_u16(input + index * 2)
    if value == load_u16(procedural + index * 2) {
      continue
    }
    let next = write_var_uint(index - previous, cursor, end)
    if next < 0 || next + 2 > end {
      return -2
    }
    cursor = next
    store_u16(cursor, value)
    cursor = cursor + 2
    previous = index
    count = count + 1
  }
  store_u32(output, count.reinterpret_as_uint())
  cursor - output
}

///|
/// Encode the exact palette-bitpack-v1 payload, preserving first-seen order.
pub fn encode_palette(input : Int, output : Int, capacity : Int) -> Int {
  if !valid_buffers(input, output, capacity, 2) || capacity < 5 {
    return -1
  }
  let palette_indexes : FixedArray[Int] = FixedArray::make(65536, -1)
  let mut palette_length = 0
  for index = 0; index < CODEC_VOXEL_COUNT; index = index + 1 {
    let value = load_u16(input + index * 2)
    let value_index = value.reinterpret_as_int()
    if palette_indexes[value_index] < 0 {
      if 5 + (palette_length + 1) * 2 > capacity {
        return -2
      }
      palette_indexes[value_index] = palette_length
      store_u16(output + 5 + palette_length * 2, value)
      palette_length = palette_length + 1
    }
  }
  let mut bits = 0
  let mut width = 1
  while width < palette_length {
    bits = bits + 1
    width = width << 1
  }
  let packed_bytes = (CODEC_VOXEL_COUNT * bits + 7) / 8
  let total = 5 + palette_length * 2 + packed_bytes
  if total > capacity {
    return -2
  }
  store_u32(output, palette_length.reinterpret_as_uint())
  store_u8(output + 4, bits.reinterpret_as_uint())
  let mut cursor = output + 5 + palette_length * 2
  let mut accumulator = 0U
  let mut accumulator_bits = 0
  for index = 0; index < CODEC_VOXEL_COUNT; index = index + 1 {
    let value = load_u16(input + index * 2)
    accumulator = accumulator |
      (
        palette_indexes[value.reinterpret_as_int()].reinterpret_as_uint() <<
        accumulator_bits
      )
    accumulator_bits = accumulator_bits + bits
    while accumulator_bits >= 8 {
      store_u8(cursor, accumulator & 255U)
      cursor = cursor + 1
      accumulator = accumulator >> 8
      accumulator_bits = accumulator_bits - 8
    }
  }
  if accumulator_bits > 0 {
    store_u8(cursor, accumulator & 255U)
  }
  total
}

///|
/// Encode the exact raw-u16-v1 little-endian payload.
pub fn encode_raw(input : Int, output : Int, capacity : Int) -> Int {
  if !valid_buffers(input, output, capacity, 2) ||
    capacity < CODEC_VOXEL_COUNT * 2 {
    return -1
  }
  for index = 0; index < CODEC_VOXEL_COUNT; index = index + 1 {
    store_u16(output + index * 2, load_u16(input + index * 2))
  }
  CODEC_VOXEL_COUNT * 2
}
