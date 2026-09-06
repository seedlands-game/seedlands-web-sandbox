///|
fn crc_table_entry(index : Int) -> UInt {
  let mut value = index.reinterpret_as_uint()
  for bit = 0; bit < 8; bit = bit + 1 {
    value = if (value & 1U) != 0U {
      0xedb88320U ^ (value >> 1)
    } else {
      value >> 1
    }
  }
  value
}

///|
let crc_table : FixedArray[UInt] = FixedArray::makei(256, crc_table_entry)

///|
fn crc_step(crc : UInt, byte : UInt) -> UInt {
  crc_table[((crc ^ byte) & 255U).reinterpret_as_int()] ^ (crc >> 8)
}

///|
pub fn crc32_bytes(offset : Int, length : Int) -> UInt {
  let mut crc = 0xffffffffU
  for index = 0; index < length; index = index + 1 {
    crc = crc_step(crc, load_u8(offset + index))
  }
  crc ^ 0xffffffffU
}

///|
pub fn crc32_u16_le(offset : Int, count : Int) -> UInt {
  let mut crc = 0xffffffffU
  for index = 0; index < count; index = index + 1 {
    let value = load_u16(offset + index * 2)
    crc = crc_step(crc, value & 255U)
    crc = crc_step(crc, (value >> 8) & 255U)
  }
  crc ^ 0xffffffffU
}
