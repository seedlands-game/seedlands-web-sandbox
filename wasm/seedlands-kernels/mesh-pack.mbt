///|
const PACK_ARENA_START = 64

///|
const PACK_ARENA_LIMIT = 16777216

///|
fn pack_valid_range(offset : Int, length : Int, width : Int) -> Bool {
  offset >= PACK_ARENA_START &&
  length >= 0 &&
  offset % width == 0 &&
  offset <= PACK_ARENA_LIMIT &&
  length <= (PACK_ARENA_LIMIT - offset) / width
}

///|
/// The production TypeScript helper intentionally maps NaN to infinity and
/// truncates the mantissa without rounding; keep that historical contract.
pub fn compact_uvs(input : Int, output : Int, count : Int) -> Int {
  if !pack_valid_range(input, count, 4) || !pack_valid_range(output, count, 2) {
    return -1
  }
  for index = 0; index < count; index = index + 1 {
    let bits = load_u32(input + index * 4)
    let sign = (bits >> 16) & 0x8000U
    let exponent = ((bits >> 23) & 0xffU).reinterpret_as_int() - 127 + 15
    let mantissa = bits & 0x7fffffU
    let value = if exponent <= 0 {
      sign
    } else if exponent >= 31 {
      sign | 0x7c00U
    } else {
      sign | (exponent.reinterpret_as_uint() << 10) | (mantissa >> 13)
    }
    store_u16(output + index * 2, value)
  }
  0
}

///|
/// Copy RGB values and replace alpha with the zero-based material id.
pub fn pack_color_alpha(
  input : Int,
  output : Int,
  count : Int,
  material : Int,
) -> Int {
  if material < 1 ||
    !pack_valid_range(input, count, 4) ||
    !pack_valid_range(output, count, 4) {
    return -1
  }
  let alpha = (material - 1).reinterpret_as_uint()
  for index = 0; index < count; index = index + 1 {
    let source = input + index * 4
    let target = output + index * 4
    store_u8(target, load_u8(source))
    store_u8(target + 1, load_u8(source + 1))
    store_u8(target + 2, load_u8(source + 2))
    store_u8(target + 3, alpha)
  }
  0
}

///|
/// Add a vertex offset to u32 indices and return the maximum resulting index.
pub fn offset_indices(
  input : Int,
  output : Int,
  count : Int,
  vertex_offset : Int,
) -> Int {
  if vertex_offset < 0 ||
    !pack_valid_range(input, count, 4) ||
    !pack_valid_range(output, count, 4) {
    return -1
  }
  let mut maximum = 0U
  for index = 0; index < count; index = index + 1 {
    let value = load_u32(input + index * 4) +
      vertex_offset.reinterpret_as_uint()
    store_u32(output + index * 4, value)
    if value > maximum {
      maximum = value
    }
  }
  maximum.reinterpret_as_int()
}
