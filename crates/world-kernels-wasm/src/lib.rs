#![no_std]

mod backend;
mod pack;

use core::panic::PanicInfo;

pub(crate) const ARENA: usize = 16 * 1024 * 1024;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[no_mangle]
pub extern "C" fn abi_version() -> i32 {
    1
}

#[no_mangle]
pub extern "C" fn arena_bytes() -> i32 {
    ARENA as i32
}

pub(crate) fn valid(offset: usize, count: usize, width: usize) -> bool {
    offset >= 64 && offset <= ARENA && offset % width == 0 && count <= (ARENA - offset) / width
}

pub(crate) fn disjoint(a: usize, a_bytes: usize, b: usize, b_bytes: usize) -> bool {
    a + a_bytes <= b || b + b_bytes <= a || a_bytes == 0 || b_bytes == 0
}

#[no_mangle]
pub extern "C" fn occupancy(input: usize, output: usize, count: usize) -> i32 {
    if !valid(input, count, 2)
        || !valid(output, count, 1)
        || !disjoint(input, count * 2, output, count)
    {
        return -1;
    }
    // ABI validation proves non-overlapping slices wholly inside the reserved arena.
    unsafe {
        let source = core::slice::from_raw_parts(input as *const u16, count);
        let target = core::slice::from_raw_parts_mut(output as *mut u8, count);
        backend::occupancy(source, target);
    }
    0
}
