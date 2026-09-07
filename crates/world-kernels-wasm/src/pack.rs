use crate::{backend, disjoint, valid};

#[no_mangle]
pub extern "C" fn compact_uvs(input: usize, output: usize, count: usize) -> i32 {
    if !valid(input, count, 4)
        || !valid(output, count, 2)
        || !disjoint(input, count * 4, output, count * 2)
    {
        return -1;
    }
    unsafe {
        let source = core::slice::from_raw_parts(input as *const u32, count);
        let target = core::slice::from_raw_parts_mut(output as *mut u16, count);
        backend::compact_uvs(source, target);
    }
    0
}

#[no_mangle]
pub extern "C" fn pack_color_alpha(
    input: usize,
    output: usize,
    count: usize,
    material: i32,
) -> i32 {
    if material < 1
        || !valid(input, count, 4)
        || !valid(output, count, 4)
        || !disjoint(input, count * 4, output, count * 4)
    {
        return -1;
    }
    unsafe {
        let source = core::slice::from_raw_parts(input as *const u8, count * 4);
        let target = core::slice::from_raw_parts_mut(output as *mut u8, count * 4);
        backend::pack_color_alpha(source, target, (material - 1) as u8);
    }
    0
}

#[no_mangle]
pub extern "C" fn offset_indices(
    input: usize,
    output: usize,
    count: usize,
    vertex_offset: i32,
) -> f64 {
    if vertex_offset < 0
        || !valid(input, count, 4)
        || !valid(output, count, 4)
        || !disjoint(input, count * 4, output, count * 4)
    {
        return -1.0;
    }
    unsafe {
        let source = core::slice::from_raw_parts(input as *const u32, count);
        let target = core::slice::from_raw_parts_mut(output as *mut u32, count);
        backend::offset_indices(source, target, vertex_offset as u32) as f64
    }
}
