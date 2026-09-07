use crate::{valid, disjoint};
use world_kernels::{codec, generation};
const CELLS: usize = 32768;
#[no_mangle]
pub extern "C" fn fill_chunk(input: usize, output: usize, oy: i32) -> i32 {
    if !valid(input,38*38*4,4) || !valid(output,CELLS,2) || !disjoint(input,38*38*16,output,CELLS*2) || oy > i32::MAX - 32 { return -1; }
    unsafe { generation::fill_chunk(core::slice::from_raw_parts(input as *const i32,38*38*4), core::slice::from_raw_parts_mut(output as *mut u16,CELLS),oy); }
    0
}
#[no_mangle]
pub extern "C" fn crc32_bytes(input: usize, count: usize) -> f64 {
    if !valid(input,count,1) { return -1.0; }
    unsafe { codec::crc32(core::slice::from_raw_parts(input as *const u8,count)) as f64 }
}
#[no_mangle]
pub extern "C" fn crc32_u16_le(input: usize, count: usize) -> f64 {
    if !valid(input,count,2) { return -1.0; }
    unsafe { codec::crc32_u16(core::slice::from_raw_parts(input as *const u16,count)) as f64 }
}
fn buffers(input: usize, output: usize, capacity: usize) -> bool {
    valid(input,CELLS,2) && valid(output,capacity,1) && disjoint(input,CELLS*2,output,capacity)
}
#[no_mangle]
pub extern "C" fn encode_diff(input: usize, base: usize, output: usize, capacity: usize) -> i32 {
    if !buffers(input,output,capacity) || !valid(base,CELLS,2) || !disjoint(base,CELLS*2,output,capacity) { return -1; }
    unsafe { codec::diff(core::slice::from_raw_parts(input as *const u16,CELLS),core::slice::from_raw_parts(base as *const u16,CELLS),core::slice::from_raw_parts_mut(output as *mut u8,capacity)).map_or(-2,|n| n as i32) }
}
#[no_mangle]
pub extern "C" fn encode_raw(input: usize, output: usize, capacity: usize) -> i32 {
    if !buffers(input,output,capacity) { return -1; }
    unsafe { codec::raw(core::slice::from_raw_parts(input as *const u16,CELLS),core::slice::from_raw_parts_mut(output as *mut u8,capacity)).map_or(-2,|n| n as i32) }
}
#[no_mangle]
pub extern "C" fn encode_palette(input: usize, output: usize, capacity: usize) -> i32 {
    if !buffers(input,output,capacity) { return -1; }
    let mut indexes = [-1;65536];
    unsafe { codec::palette(core::slice::from_raw_parts(input as *const u16,CELLS),core::slice::from_raw_parts_mut(output as *mut u8,capacity), &mut indexes).map_or(-2,|n| n as i32) }
}

#[no_mangle]
pub extern "C" fn fill_halo(columns: usize, known: usize, halo: usize, fluid: usize, oy: i32) -> f64 {
    const N: usize = 34*34*34;
    if !valid(columns,40*40*4,4) || !valid(known,N,4) || !valid(halo,N,2) || !valid(fluid,N,1) || oy > i32::MAX - 34 { return -1.0; }
    let buffers=[(columns,40*40*16),(known,N*4),(halo,N*2),(fluid,N)];
    for a in 0..4 { for b in a+1..4 { if !disjoint(buffers[a].0,buffers[a].1,buffers[b].0,buffers[b].1) {return -1.0;} } }
    unsafe { generation::fill_halo(core::slice::from_raw_parts(columns as *const i32,40*40*4),core::slice::from_raw_parts(known as *const u32,N),core::slice::from_raw_parts_mut(halo as *mut u16,N),core::slice::from_raw_parts_mut(fluid as *mut u8,N),oy) as f64 }
}
