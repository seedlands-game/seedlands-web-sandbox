const fn table() -> [u32; 256] {
    let mut result = [0; 256]; let mut i = 0;
    while i < 256 { let mut v = i as u32; let mut b = 0;
        while b < 8 { v = if v & 1 != 0 { 0xedb88320 ^ (v >> 1) } else { v >> 1 }; b += 1; }
        result[i] = v; i += 1;
    } result
}
const CRC: [u32; 256] = table();
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut v = u32::MAX;
    for &b in bytes { v = CRC[((v ^ b as u32) & 255) as usize] ^ (v >> 8); }
    v ^ u32::MAX
}
pub fn crc32_u16(values: &[u16]) -> u32 {
    let mut v = u32::MAX;
    for &x in values { for b in x.to_le_bytes() { v = CRC[((v ^ b as u32) & 255) as usize] ^ (v >> 8); } }
    v ^ u32::MAX
}
pub fn raw(input: &[u16], output: &mut [u8]) -> Option<usize> {
    if output.len() < input.len()*2 { return None; }
    for (i, v) in input.iter().enumerate() { output[i*2..i*2+2].copy_from_slice(&v.to_le_bytes()); }
    Some(input.len()*2)
}
pub fn diff(input: &[u16], base: &[u16], output: &mut [u8]) -> Option<usize> {
    if input.len() != base.len() || output.len() < 4 { return None; }
    let mut count = 0u32; let mut previous = 0; let mut cursor = 4;
    for (i, (&v, &b)) in input.iter().zip(base).enumerate() {
        if v == b { continue; }
        let mut delta = i - previous;
        loop { let byte = (delta & 127) as u8; delta >>= 7;
            *output.get_mut(cursor)? = if delta != 0 { byte | 128 } else { byte }; cursor += 1;
            if delta == 0 { break; }
        }
        output.get_mut(cursor..cursor+2)?.copy_from_slice(&v.to_le_bytes()); cursor += 2;
        previous = i; count += 1;
    }
    output[..4].copy_from_slice(&count.to_le_bytes()); Some(cursor)
}
pub fn palette(input: &[u16], output: &mut [u8], indexes: &mut [i32]) -> Option<usize> {
    if output.len() < 5 || indexes.len() != 65536 { return None; }
    indexes.fill(-1); let mut length = 0usize;
    for &v in input {
        if indexes[v as usize] < 0 {
            output.get_mut(5+length*2..7+length*2)?.copy_from_slice(&v.to_le_bytes());
            indexes[v as usize] = length as i32; length += 1;
        }
    }
    let mut bits = 0; let mut width = 1;
    while width < length { width <<= 1; bits += 1; }
    let total = 5 + length*2 + (input.len()*bits + 7)/8;
    if total > output.len() { return None; }
    output[..4].copy_from_slice(&(length as u32).to_le_bytes()); output[4] = bits as u8;
    let mut cursor = 5+length*2; let mut accumulator = 0u32; let mut accumulated = 0;
    for &v in input {
        accumulator |= (indexes[v as usize] as u32) << accumulated; accumulated += bits;
        while accumulated >= 8 { output[cursor] = accumulator as u8; cursor += 1; accumulator >>= 8; accumulated -= 8; }
    }
    if accumulated != 0 { output[cursor] = accumulator as u8; }
    Some(total)
}
