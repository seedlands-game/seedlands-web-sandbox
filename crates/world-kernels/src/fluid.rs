pub const CHUNK_CELLS: usize = 32 * 32 * 32;
pub const MAX_CHUNKS: usize = 32;
pub const MAX_POSITIONS: usize = 192;
pub const MAX_WRITES: usize = 2_048;
pub const MAX_NEXT: usize = 16_384;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct FluidPosition {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

impl FluidPosition {
    pub const ZERO: Self = Self::new(0, 0, 0);

    pub const fn new(x: i32, y: i32, z: i32) -> Self {
        Self { x, y, z }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FluidChunkLayout {
    pub cx: i32,
    pub cy: i32,
    pub cz: i32,
    pub voxel_offset: usize,
    pub fluid_offset: usize,
}

impl FluidChunkLayout {
    pub const EMPTY: Self = Self {
        cx: 0,
        cy: 0,
        cz: 0,
        voxel_offset: 0,
        fluid_offset: 0,
    };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FluidWrite {
    pub position: FluidPosition,
    pub original: u32,
    pub chunk_index: usize,
    pub local_index: usize,
}

impl FluidWrite {
    pub const EMPTY: Self = Self {
        position: FluidPosition::ZERO,
        original: 0,
        chunk_index: 0,
        local_index: 0,
    };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FluidError {
    InvalidInput,
    InvalidLayout,
    InvalidScratchState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FluidOutcome {
    pub write_count: usize,
    pub next_count: usize,
    pub unknown_count: u32,
    pub needs_rescan: bool,
}

pub struct FluidScratch<'a> {
    writes: &'a mut [FluidWrite],
    next: &'a mut [FluidPosition],
    write_count: usize,
    next_count: usize,
    unknown_count: u32,
    needs_rescan: bool,
}

impl<'a> FluidScratch<'a> {
    pub fn new(writes: &'a mut [FluidWrite], next: &'a mut [FluidPosition]) -> Self {
        Self {
            writes,
            next,
            write_count: 0,
            next_count: 0,
            unknown_count: 0,
            needs_rescan: false,
        }
    }

    pub fn with_state(
        writes: &'a mut [FluidWrite],
        next: &'a mut [FluidPosition],
        write_count: usize,
        next_count: usize,
        unknown_count: u32,
        needs_rescan: bool,
    ) -> Result<Self, FluidError> {
        if write_count > writes.len()
            || write_count > MAX_WRITES
            || next_count > next.len()
            || next_count > MAX_NEXT
        {
            return Err(FluidError::InvalidScratchState);
        }
        Ok(Self {
            writes,
            next,
            write_count,
            next_count,
            unknown_count,
            needs_rescan,
        })
    }

    pub fn writes(&self) -> &[FluidWrite] {
        &self.writes[..self.write_count]
    }

    pub fn next(&self) -> &[FluidPosition] {
        &self.next[..self.next_count]
    }
}

struct FluidContext<'arena, 'chunks, 'scratch, 'buffers> {
    arena: &'arena mut [u8],
    chunks: &'chunks [FluidChunkLayout],
    scratch: &'scratch mut FluidScratch<'buffers>,
}

impl FluidContext<'_, '_, '_, '_> {
    fn chunk_coord(value: i32) -> i32 {
        if value < 0 {
            (value - 31) / 32
        } else {
            value / 32
        }
    }

    fn address(&mut self, position: FluidPosition) -> Option<(usize, usize)> {
        let cx = Self::chunk_coord(position.x);
        let cy = Self::chunk_coord(position.y);
        let cz = Self::chunk_coord(position.z);
        for (chunk_index, chunk) in self.chunks.iter().enumerate() {
            if chunk.cx == cx && chunk.cy == cy && chunk.cz == cz {
                let local = (position.x - cx * 32)
                    + 32 * ((position.z - cz * 32) + 32 * (position.y - cy * 32));
                return Some((chunk_index, local as usize));
            }
        }
        self.scratch.unknown_count = self.scratch.unknown_count.wrapping_add(1);
        None
    }

    fn voxel(&self, chunk_index: usize, local_index: usize) -> u16 {
        let offset = self.chunks[chunk_index].voxel_offset + local_index * 2;
        u16::from_le_bytes([self.arena[offset], self.arena[offset + 1]])
    }

    fn set_voxel(&mut self, chunk_index: usize, local_index: usize, voxel: u16) {
        let offset = self.chunks[chunk_index].voxel_offset + local_index * 2;
        self.arena[offset..offset + 2].copy_from_slice(&voxel.to_le_bytes());
    }

    fn fluid(&self, chunk_index: usize, local_index: usize) -> u8 {
        self.arena[self.chunks[chunk_index].fluid_offset + local_index]
    }

    fn set_fluid(&mut self, chunk_index: usize, local_index: usize, fluid: u8) {
        let offset = self.chunks[chunk_index].fluid_offset + local_index;
        self.arena[offset] = fluid;
    }

    fn cell(&mut self, position: FluidPosition) -> i32 {
        let Some((chunk_index, local_index)) = self.address(position) else {
            return -1;
        };
        let voxel = self.voxel(chunk_index, local_index) as u32;
        let stored_fluid = self.fluid(chunk_index, local_index) as u32;
        let level = if voxel == 8 && stored_fluid == 0 {
            0x88
        } else {
            stored_fluid
        };
        (voxel | (level << 16)) as i32
    }

    fn activate(&mut self, position: FluidPosition) {
        if position.y < 0 || position.y > 63 {
            return;
        }
        if self.scratch.next_count >= self.scratch.next.len() || self.scratch.next_count >= MAX_NEXT {
            self.scratch.needs_rescan = true;
            return;
        }
        self.scratch.next[self.scratch.next_count] = position;
        self.scratch.next_count += 1;
    }

    fn neighborhood(&mut self, position: FluidPosition) {
        self.activate(position);
        self.activate(FluidPosition::new(position.x, position.y - 1, position.z));
        self.activate(FluidPosition::new(position.x, position.y + 1, position.z));
        self.activate(FluidPosition::new(position.x - 1, position.y, position.z));
        self.activate(FluidPosition::new(position.x + 1, position.y, position.z));
        self.activate(FluidPosition::new(position.x, position.y, position.z - 1));
        self.activate(FluidPosition::new(position.x, position.y, position.z + 1));
    }

    fn write(&mut self, position: FluidPosition, voxel: u16, fluid: u8) {
        let Some((chunk_index, local_index)) = self.address(position) else {
            return;
        };
        let seen = self.scratch.writes[..self.scratch.write_count]
            .iter()
            .any(|write| write.chunk_index == chunk_index && write.local_index == local_index);
        if !seen {
            if self.scratch.write_count >= self.scratch.writes.len() || self.scratch.write_count >= MAX_WRITES {
                self.scratch.needs_rescan = true;
                return;
            }
            let original = self.voxel(chunk_index, local_index) as u32
                | ((self.fluid(chunk_index, local_index) as u32) << 16);
            self.scratch.writes[self.scratch.write_count] = FluidWrite {
                position,
                original,
                chunk_index,
                local_index,
            };
            self.scratch.write_count += 1;
        }
        self.set_voxel(chunk_index, local_index, voxel);
        self.set_fluid(chunk_index, local_index, fluid);
    }

    fn place(&mut self, position: FluidPosition, level: i32) {
        let Some((chunk_index, local_index)) = self.address(position) else {
            return;
        };
        let voxel = self.voxel(chunk_index, local_index);
        if voxel != 0 && voxel != 8 {
            return;
        }
        let next = level.clamp(1, 8) as u8;
        if voxel == 8 && self.fluid(chunk_index, local_index) == next {
            return;
        }
        self.write(position, 8, next);
        self.neighborhood(position);
    }
}

fn water(value: i32) -> bool {
    value >= 0 && (value & 65_535) == 8
}

fn level(value: i32) -> i32 {
    (value >> 16) & 15
}

fn side(position: FluidPosition, direction: i32) -> FluidPosition {
    match direction {
        0 => FluidPosition::new(position.x - 1, position.y, position.z),
        1 => FluidPosition::new(position.x + 1, position.y, position.z),
        2 => FluidPosition::new(position.x, position.y, position.z - 1),
        _ => FluidPosition::new(position.x, position.y, position.z + 1),
    }
}

fn ranges_overlap(left_start: usize, left_bytes: usize, right_start: usize, right_bytes: usize) -> bool {
    left_start < right_start + right_bytes && right_start < left_start + left_bytes
}

pub fn fluid_candidate(
    arena: &mut [u8],
    chunks: &[FluidChunkLayout],
    positions: &[FluidPosition],
    scratch: &mut FluidScratch<'_>,
) -> Result<FluidOutcome, FluidError> {
    if chunks.len() > MAX_CHUNKS || positions.len() > MAX_POSITIONS
        || positions.iter().any(|p| [p.x, p.y, p.z].iter().any(|v| v.unsigned_abs() >= 1 << 29))
        || chunks.iter().any(|c| [c.cx, c.cy, c.cz].iter().any(|v| v.unsigned_abs() >= 1 << 25))
    {
        return Err(FluidError::InvalidInput);
    }
    for (index, chunk) in chunks.iter().enumerate() {
        let voxel_bytes = CHUNK_CELLS * 2;
        let fluid_bytes = CHUNK_CELLS;
        if chunk.voxel_offset.checked_add(voxel_bytes).map_or(true, |end| end > arena.len())
            || chunk.fluid_offset.checked_add(fluid_bytes).map_or(true, |end| end > arena.len())
            || ranges_overlap(chunk.voxel_offset, voxel_bytes, chunk.fluid_offset, fluid_bytes)
        {
            return Err(FluidError::InvalidLayout);
        }
        for previous in &chunks[..index] {
            if (chunk.cx, chunk.cy, chunk.cz) == (previous.cx, previous.cy, previous.cz)
                || ranges_overlap(chunk.voxel_offset, voxel_bytes, previous.voxel_offset, voxel_bytes)
                || ranges_overlap(chunk.voxel_offset, voxel_bytes, previous.fluid_offset, fluid_bytes)
                || ranges_overlap(chunk.fluid_offset, fluid_bytes, previous.voxel_offset, voxel_bytes)
                || ranges_overlap(chunk.fluid_offset, fluid_bytes, previous.fluid_offset, fluid_bytes)
            {
                return Err(FluidError::InvalidLayout);
            }
        }
    }

    let mut context = FluidContext {
        arena,
        chunks,
        scratch,
    };
    for &position in positions {
        let current = context.cell(position);
        if !water(current) {
            continue;
        }
        let current_level = level(current);
        let source = (current & 0x800000) != 0;
        if !source {
            let unknown_before = context.scratch.unknown_count;
            let above = context.cell(FluidPosition::new(position.x, position.y + 1, position.z));
            let mut desired = 0;
            if water(above) {
                desired = 8;
            } else {
                for direction in 0..4 {
                    let neighbor = context.cell(side(position, direction));
                    if water(neighbor) && level(neighbor) - 1 > desired {
                        desired = level(neighbor) - 1;
                    }
                }
            }
            let above_again = context.cell(FluidPosition::new(position.x, position.y + 1, position.z));
            let mut stronger = false;
            for direction in 0..4 {
                let neighbor = context.cell(side(position, direction));
                if water(neighbor) && level(neighbor) > current_level {
                    stronger = true;
                    break;
                }
            }
            if !water(above_again) && !stronger && desired > current_level - 1 {
                desired = current_level - 1;
            }
            if desired < current_level && unknown_before != context.scratch.unknown_count {
                context.activate(position);
                continue;
            }
            if desired <= 0 {
                context.write(position, 0, 0);
                context.neighborhood(position);
                continue;
            }
            if desired != current_level {
                context.write(position, 8, desired as u8);
                context.neighborhood(position);
            }
        }
        let below_position = FluidPosition::new(position.x, position.y - 1, position.z);
        let below = context.cell(below_position);
        if below < 0 {
            continue;
        }
        if (below & 65_535) == 0 {
            context.place(below_position, 8);
            context.activate(position);
            continue;
        }
        if water(below) {
            continue;
        }
        let settled = context.cell(position);
        let settled_level = if settled < 0 { 0 } else { level(settled) };
        if settled_level <= 1 {
            continue;
        }
        for direction in 0..4 {
            let target_position = side(position, direction);
            let target = context.cell(target_position);
            if target < 0 {
                continue;
            }
            if (target & 65_535) == 0
                || (water(target) && (target & 0x800000) == 0 && level(target) < settled_level - 1)
            {
                context.place(target_position, settled_level - 1);
            }
        }
    }
    Ok(FluidOutcome {
        write_count: context.scratch.write_count,
        next_count: context.scratch.next_count,
        unknown_count: context.scratch.unknown_count,
        needs_rescan: context.scratch.needs_rescan,
    })
}
