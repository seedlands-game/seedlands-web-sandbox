pub(crate) fn occupancy(input: &[u16], output: &mut [u8]) {
    #[cfg(feature = "simd")]
    unsafe {
        return occupancy_simd(input, output);
    }
    #[cfg(not(feature = "simd"))]
    world_kernels::occupancy(input, output);
}

pub(crate) fn compact_uvs(input: &[u32], output: &mut [u16]) {
    #[cfg(feature = "simd")]
    unsafe {
        return compact_uvs_simd(input, output);
    }
    #[cfg(not(feature = "simd"))]
    world_kernels::pack::compact_uvs(input, output);
}

pub(crate) fn pack_color_alpha(input: &[u8], output: &mut [u8], alpha: u8) {
    #[cfg(feature = "simd")]
    unsafe {
        return pack_color_alpha_simd(input, output, alpha);
    }
    #[cfg(not(feature = "simd"))]
    world_kernels::pack::pack_color_alpha(input, output, alpha);
}

pub(crate) fn offset_indices(input: &[u32], output: &mut [u32], vertex_offset: u32) -> u32 {
    #[cfg(feature = "simd")]
    unsafe {
        return offset_indices_simd(input, output, vertex_offset);
    }
    #[cfg(not(feature = "simd"))]
    world_kernels::pack::offset_indices(input, output, vertex_offset)
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
unsafe fn occupancy_simd(input: &[u16], output: &mut [u8]) {
    use core::arch::wasm32::*;

    let zero = u16x8_splat(0);
    let water = u16x8_splat(8);
    let one = u16x8_splat(1);
    let mut index = 0;
    while index + 16 <= input.len() {
        let a = v128_load(input.as_ptr().add(index) as *const v128);
        let b = v128_load(input.as_ptr().add(index + 8) as *const v128);
        let a = v128_and(
            v128_not(v128_or(u16x8_eq(a, zero), u16x8_eq(a, water))),
            one,
        );
        let b = v128_and(
            v128_not(v128_or(u16x8_eq(b, zero), u16x8_eq(b, water))),
            one,
        );
        v128_store(
            output.as_mut_ptr().add(index) as *mut v128,
            u8x16_narrow_i16x8(a, b),
        );
        index += 16;
    }
    world_kernels::occupancy(&input[index..], &mut output[index..]);
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
unsafe fn compact_uvs_simd(input: &[u32], output: &mut [u16]) {
    use core::arch::wasm32::*;

    let sign_mask = i32x4_splat(0x8000);
    let mantissa_mask = i32x4_splat(0x7fffff);
    let infinity = i32x4_splat(0x7c00);
    let zero = i32x4_splat(0);
    let exponent_limit = i32x4_splat(31);
    let exponent_bias = i32x4_splat(112);
    let mut index = 0;
    while index + 8 <= input.len() {
        let a = compact_uvs_lanes(
            v128_load(input.as_ptr().add(index) as *const v128),
            sign_mask,
            mantissa_mask,
            infinity,
            zero,
            exponent_limit,
            exponent_bias,
        );
        let b = compact_uvs_lanes(
            v128_load(input.as_ptr().add(index + 4) as *const v128),
            sign_mask,
            mantissa_mask,
            infinity,
            zero,
            exponent_limit,
            exponent_bias,
        );
        v128_store(
            output.as_mut_ptr().add(index) as *mut v128,
            u16x8_narrow_i32x4(a, b),
        );
        index += 8;
    }
    world_kernels::pack::compact_uvs(&input[index..], &mut output[index..]);
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
unsafe fn compact_uvs_lanes(
    bits: core::arch::wasm32::v128,
    sign_mask: core::arch::wasm32::v128,
    mantissa_mask: core::arch::wasm32::v128,
    infinity: core::arch::wasm32::v128,
    zero: core::arch::wasm32::v128,
    exponent_limit: core::arch::wasm32::v128,
    exponent_bias: core::arch::wasm32::v128,
) -> core::arch::wasm32::v128 {
    use core::arch::wasm32::*;

    let sign = v128_and(u32x4_shr(bits, 16), sign_mask);
    let exponent = i32x4_sub(
        v128_and(u32x4_shr(bits, 23), i32x4_splat(0xff)),
        exponent_bias,
    );
    let normal = v128_or(
        v128_or(sign, i32x4_shl(exponent, 10)),
        u32x4_shr(v128_and(bits, mantissa_mask), 13),
    );
    let normal_mask = v128_and(i32x4_gt(exponent, zero), i32x4_lt(exponent, exponent_limit));
    let finite = v128_bitselect(normal, sign, normal_mask);
    v128_bitselect(
        v128_or(sign, infinity),
        finite,
        i32x4_ge(exponent, exponent_limit),
    )
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
unsafe fn pack_color_alpha_simd(input: &[u8], output: &mut [u8], alpha: u8) {
    use core::arch::wasm32::*;

    let rgb_mask = i32x4_splat(0x00ff_ffff);
    let alpha_lanes = i32x4_splat((alpha as i32) << 24);
    let mut index = 0;
    while index + 16 <= input.len() {
        let source = v128_load(input.as_ptr().add(index) as *const v128);
        v128_store(
            output.as_mut_ptr().add(index) as *mut v128,
            v128_or(v128_and(source, rgb_mask), alpha_lanes),
        );
        index += 16;
    }
    world_kernels::pack::pack_color_alpha(&input[index..], &mut output[index..], alpha);
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
unsafe fn offset_indices_simd(input: &[u32], output: &mut [u32], vertex_offset: u32) -> u32 {
    use core::arch::wasm32::*;

    let offset = i32x4_splat(vertex_offset as i32);
    let mut maxima = u32x4_splat(0);
    let mut index = 0;
    while index + 4 <= input.len() {
        let values = i32x4_add(v128_load(input.as_ptr().add(index) as *const v128), offset);
        v128_store(output.as_mut_ptr().add(index) as *mut v128, values);
        maxima = u32x4_max(maxima, values);
        index += 4;
    }
    let maximum = (i32x4_extract_lane::<0>(maxima) as u32)
        .max(i32x4_extract_lane::<1>(maxima) as u32)
        .max(i32x4_extract_lane::<2>(maxima) as u32)
        .max(i32x4_extract_lane::<3>(maxima) as u32);
    maximum.max(world_kernels::pack::offset_indices(
        &input[index..],
        &mut output[index..],
        vertex_offset,
    ))
}
