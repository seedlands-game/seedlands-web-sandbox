/// Convert f32 bit patterns to the historical compact-UV representation.
///
/// This intentionally truncates rather than rounds and maps every NaN to
/// signed infinity, matching the existing TypeScript and MoonBit contracts.
pub fn compact_uvs(input: &[u32], output: &mut [u16]) {
    assert_eq!(input.len(), output.len());
    for (bits, target) in input.iter().zip(output.iter_mut()) {
        let sign = (bits >> 16) & 0x8000;
        let exponent = ((bits >> 23) & 0xff) as i32 - 127 + 15;
        let mantissa = bits & 0x7fffff;
        *target = if exponent <= 0 {
            sign as u16
        } else if exponent >= 31 {
            (sign | 0x7c00) as u16
        } else {
            (sign | ((exponent as u32) << 10) | (mantissa >> 13)) as u16
        };
    }
}

/// Copy RGB channels and replace alpha with the zero-based material id.
pub fn pack_color_alpha(input: &[u8], output: &mut [u8], alpha: u8) {
    assert_eq!(input.len(), output.len());
    assert_eq!(input.len() % 4, 0);
    for (source, target) in input.chunks_exact(4).zip(output.chunks_exact_mut(4)) {
        target[0] = source[0];
        target[1] = source[1];
        target[2] = source[2];
        target[3] = alpha;
    }
}

/// Add an offset with u32 wraparound and return the unsigned maximum.
pub fn offset_indices(input: &[u32], output: &mut [u32], vertex_offset: u32) -> u32 {
    assert_eq!(input.len(), output.len());
    let mut maximum = 0;
    for (source, target) in input.iter().zip(output.iter_mut()) {
        let value = source.wrapping_add(vertex_offset);
        *target = value;
        maximum = maximum.max(value);
    }
    maximum
}
