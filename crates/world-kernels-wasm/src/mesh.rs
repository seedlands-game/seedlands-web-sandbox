use crate::{disjoint, valid, ARENA};
use world_kernels::mesh::{
    mesh_describe as run_mesh_describe, MeshError, HALO_CELLS, MASK_BYTES, MAX_DESCRIPTOR_BYTES,
};

const MESH_ARENA_START: i32 = 64;
const MESH_ARENA_LIMIT: i32 = ARENA as i32;

#[no_mangle]
pub extern "C" fn mesh_describe(halo: i32, fluid: i32, output: i32, capacity: i32) -> i32 {
    if halo < MESH_ARENA_START
        || fluid < MESH_ARENA_START
        || output < MESH_ARENA_START
        || halo % 2 != 0
        || capacity < 0
    {
        return -1;
    }
    if halo > MESH_ARENA_LIMIT - (HALO_CELLS * 2) as i32
        || fluid > MESH_ARENA_LIMIT - HALO_CELLS as i32
        || output > MESH_ARENA_LIMIT - MASK_BYTES as i32
        || capacity > MESH_ARENA_LIMIT - output - MASK_BYTES as i32
    {
        return -1;
    }
    let halo = halo as usize;
    let fluid = fluid as usize;
    let output = output as usize;
    let capacity = capacity as usize;
    let output_bytes = MASK_BYTES + capacity;
    if !valid(halo, HALO_CELLS, 2)
        || !valid(fluid, HALO_CELLS, 1)
        || !valid(output, output_bytes, 1)
        || !disjoint(output, output_bytes, halo, HALO_CELLS * 2)
        || !disjoint(output, output_bytes, fluid, HALO_CELLS)
    {
        return -1;
    }
    unsafe {
        let halo = core::slice::from_raw_parts(halo as *const u16, HALO_CELLS);
        let fluid = core::slice::from_raw_parts(fluid as *const u8, HALO_CELLS);
        let output = core::slice::from_raw_parts_mut(output as *mut u8, output_bytes);
        let (mask, descriptors) = output.split_at_mut(MASK_BYTES);
        match run_mesh_describe(halo, fluid, mask, descriptors) {
            Ok(length) if length <= MAX_DESCRIPTOR_BYTES => length as i32,
            Ok(_) => -1,
            Err(MeshError::Capacity) => -2,
            Err(MeshError::InvalidInput) => -1,
        }
    }
}
