use crate::{disjoint, valid, ARENA};
use world_kernels::fluid::{
    fluid_candidate as run_fluid_candidate, FluidChunkLayout, FluidPosition, FluidScratch, FluidWrite, CHUNK_CELLS,
    MAX_CHUNKS, MAX_NEXT, MAX_POSITIONS, MAX_WRITES,
};

const ARENA_START: usize = 64;
const CHUNK_ROWS: usize = 1_024;
const FRONTIER_ROWS: usize = 8_192;
const WRITES: usize = 4 * 1_024 * 1_024;
const NEXT: usize = 5 * 1_024 * 1_024;

unsafe fn load_u32(offset: usize) -> u32 {
    (offset as *const u32).read_unaligned()
}

unsafe fn store_u32(offset: usize, value: u32) {
    (offset as *mut u32).write_unaligned(value);
}

fn signed(value: u32) -> i32 {
    value as i32
}

fn write_location(
    chunks: &[FluidChunkLayout],
    voxel_pointer: usize,
    fluid_pointer: usize,
) -> Option<(usize, usize)> {
    chunks.iter().enumerate().find_map(|(chunk_index, chunk)| {
        let voxel_base = chunk.voxel_offset + ARENA_START;
        let fluid_base = chunk.fluid_offset + ARENA_START;
        if voxel_pointer < voxel_base || fluid_pointer < fluid_base {
            return None;
        }
        let voxel_delta = voxel_pointer - voxel_base;
        let fluid_delta = fluid_pointer - fluid_base;
        if voxel_delta % 2 != 0 || voxel_delta / 2 != fluid_delta || fluid_delta >= CHUNK_CELLS {
            return None;
        }
        Some((chunk_index, fluid_delta))
    })
}

#[no_mangle]
pub extern "C" fn fluid_candidate(count: i32) -> i32 {
    unsafe {
        let chunk_count = signed(load_u32(64));
        if count < 0 || count as usize > MAX_POSITIONS || chunk_count < 0 || chunk_count as usize > MAX_CHUNKS {
            return 1;
        }
        let write_count = load_u32(72) as usize;
        let next_count = load_u32(76) as usize;
        if write_count > MAX_WRITES || next_count > MAX_NEXT {
            return 1;
        }

        let mut chunks = [FluidChunkLayout::EMPTY; MAX_CHUNKS];
        for index in 0..chunk_count as usize {
            let row = CHUNK_ROWS + index * 20;
            let voxel_offset = load_u32(row + 12) as usize;
            let fluid_offset = load_u32(row + 16) as usize;
            let voxel_bytes = CHUNK_CELLS * 2;
            let fluid_bytes = CHUNK_CELLS;
            if !valid(voxel_offset, CHUNK_CELLS, 2)
                || !valid(fluid_offset, CHUNK_CELLS, 1)
                || !disjoint(voxel_offset, voxel_bytes, fluid_offset, fluid_bytes)
                || !disjoint(voxel_offset, voxel_bytes, 64, 32)
                || !disjoint(fluid_offset, fluid_bytes, 64, 32)
                || !disjoint(voxel_offset, voxel_bytes, CHUNK_ROWS, MAX_CHUNKS * 20)
                || !disjoint(fluid_offset, fluid_bytes, CHUNK_ROWS, MAX_CHUNKS * 20)
                || !disjoint(voxel_offset, voxel_bytes, FRONTIER_ROWS, MAX_POSITIONS * 12)
                || !disjoint(fluid_offset, fluid_bytes, FRONTIER_ROWS, MAX_POSITIONS * 12)
                || !disjoint(voxel_offset, voxel_bytes, WRITES, MAX_WRITES * 24)
                || !disjoint(fluid_offset, fluid_bytes, WRITES, MAX_WRITES * 24)
                || !disjoint(voxel_offset, voxel_bytes, NEXT, MAX_NEXT * 12)
                || !disjoint(fluid_offset, fluid_bytes, NEXT, MAX_NEXT * 12)
            {
                return 1;
            }
            for previous in &chunks[..index] {
                let previous_voxel = previous.voxel_offset + ARENA_START;
                let previous_fluid = previous.fluid_offset + ARENA_START;
                if !disjoint(voxel_offset, voxel_bytes, previous_voxel, voxel_bytes)
                    || !disjoint(voxel_offset, voxel_bytes, previous_fluid, fluid_bytes)
                    || !disjoint(fluid_offset, fluid_bytes, previous_voxel, voxel_bytes)
                    || !disjoint(fluid_offset, fluid_bytes, previous_fluid, fluid_bytes)
                {
                    return 1;
                }
            }
            chunks[index] = FluidChunkLayout {
                cx: signed(load_u32(row)),
                cy: signed(load_u32(row + 4)),
                cz: signed(load_u32(row + 8)),
                voxel_offset: voxel_offset - ARENA_START,
                fluid_offset: fluid_offset - ARENA_START,
            };
        }
        let chunks = &chunks[..chunk_count as usize];

        let mut positions = [FluidPosition::ZERO; MAX_POSITIONS];
        for (index, position) in positions[..count as usize].iter_mut().enumerate() {
            let row = FRONTIER_ROWS + index * 12;
            *position = FluidPosition::new(
                signed(load_u32(row)),
                signed(load_u32(row + 4)),
                signed(load_u32(row + 8)),
            );
        }

        let mut writes = [FluidWrite::EMPTY; MAX_WRITES];
        for (index, write) in writes[..write_count].iter_mut().enumerate() {
            let row = WRITES + index * 24;
            let voxel_pointer = load_u32(row + 16) as usize;
            let fluid_pointer = load_u32(row + 20) as usize;
            let Some((chunk_index, local_index)) = write_location(chunks, voxel_pointer, fluid_pointer) else {
                return 1;
            };
            *write = FluidWrite {
                position: FluidPosition::new(
                    signed(load_u32(row)),
                    signed(load_u32(row + 4)),
                    signed(load_u32(row + 8)),
                ),
                original: load_u32(row + 12),
                chunk_index,
                local_index,
            };
        }
        let mut next = [FluidPosition::ZERO; MAX_NEXT];
        for (index, position) in next[..next_count].iter_mut().enumerate() {
            let row = NEXT + index * 12;
            *position = FluidPosition::new(
                signed(load_u32(row)),
                signed(load_u32(row + 4)),
                signed(load_u32(row + 8)),
            );
        }
        let Ok(mut scratch) = FluidScratch::with_state(
            &mut writes,
            &mut next,
            write_count,
            next_count,
            load_u32(68),
            load_u32(80) != 0,
        ) else {
            return 1;
        };
        let arena = core::slice::from_raw_parts_mut(ARENA_START as *mut u8, ARENA - ARENA_START);
        let Ok(outcome) = run_fluid_candidate(arena, chunks, &positions[..count as usize], &mut scratch) else {
            return 1;
        };

        for (index, write) in scratch.writes().iter().enumerate() {
            let row = WRITES + index * 24;
            let chunk = chunks[write.chunk_index];
            store_u32(row, write.position.x as u32);
            store_u32(row + 4, write.position.y as u32);
            store_u32(row + 8, write.position.z as u32);
            store_u32(row + 12, write.original);
            store_u32(
                row + 16,
                (chunk.voxel_offset + ARENA_START + write.local_index * 2) as u32,
            );
            store_u32(row + 20, (chunk.fluid_offset + ARENA_START + write.local_index) as u32);
        }
        for (index, position) in scratch.next().iter().enumerate() {
            let row = NEXT + index * 12;
            store_u32(row, position.x as u32);
            store_u32(row + 4, position.y as u32);
            store_u32(row + 8, position.z as u32);
        }
        store_u32(68, outcome.unknown_count);
        store_u32(72, outcome.write_count as u32);
        store_u32(76, outcome.next_count as u32);
        store_u32(80, u32::from(outcome.needs_rescan));
        outcome.needs_rescan as i32
    }
}
