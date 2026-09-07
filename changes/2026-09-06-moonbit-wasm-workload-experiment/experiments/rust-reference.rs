#![no_std]

//! Rust reference for the three representative MoonBit kernels.
//!
//! This file deliberately follows the existing MoonBit source one function at a
//! time. It is an experiment-only Wasm module: no production Rust import is
//! allowed. The ABI uses the same first 16 MiB arena and the same raw offsets as
//! `wasm/seedlands-kernels/{chunk,fluid,mesh}.mbt`.

use core::panic::PanicInfo;

const ARENA_BYTES: i32 = 16 * 1024 * 1024;
const MESH_ARENA_START: i32 = 64;
const MESH_ARENA_LIMIT: i32 = 16 * 1024 * 1024;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[inline(always)]
unsafe fn load_u8(offset: i32) -> u32 {
    (offset as u32 as usize as *const u8).read() as u32
}

#[inline(always)]
unsafe fn load_u16(offset: i32) -> u32 {
    (offset as u32 as usize as *const u16).read_unaligned() as u32
}

#[inline(always)]
unsafe fn load_u32(offset: i32) -> u32 {
    (offset as u32 as usize as *const u32).read_unaligned()
}

#[inline(always)]
unsafe fn store_u8(offset: i32, value: u32) {
    (offset as u32 as usize as *mut u8).write(value as u8)
}

#[inline(always)]
unsafe fn store_u16(offset: i32, value: u32) {
    (offset as u32 as usize as *mut u16).write_unaligned(value as u16)
}

#[inline(always)]
unsafe fn store_u32(offset: i32, value: u32) {
    (offset as u32 as usize as *mut u32).write_unaligned(value)
}

#[no_mangle]
pub extern "C" fn abi_version() -> i32 {
    1
}

#[no_mangle]
pub extern "C" fn arena_bytes() -> i32 {
    ARENA_BYTES
}

// ---- W03 chunk -----------------------------------------------------------

#[inline(always)]
unsafe fn column_voxel(input: i32, grid: i32, x: i32, y: i32, z: i32) -> u32 {
    let column = input + ((x + 3) + grid * (z + 3)) * 16;
    let height = load_u32(column) as i32;
    let kind = load_u32(column + 4);
    let water_level = load_u32(column + 8) as i32;
    if y > height && y <= water_level {
        return 8;
    }
    if y <= height {
        if y == height {
            return if kind == 3 {
                6
            } else if kind == 4 {
                7
            } else if kind == 2 {
                3
            } else {
                1
            };
        }
        return if y > height - 4 {
            if kind == 3 {
                6
            } else if kind == 2 {
                3
            } else {
                2
            }
        } else {
            3
        };
    }
    let mut tx = x;
    while tx <= x + 6 {
        let mut tz = z;
        while tz <= z + 6 {
            let tree_column = input + (tx + grid * tz) * 16;
            if load_u32(tree_column + 12) != 0 {
                let th = load_u32(tree_column) as i32;
                let dx = (x + 3 - tx).abs();
                let dz = (z + 3 - tz).abs();
                if dx == 0 && dz == 0 && y > th && y <= th + 4 {
                    return 4;
                }
                if dx <= 2 && dz <= 2 && y >= th + 3 && y <= th + 6 && (dx + dz < 4 || y >= th + 5)
                {
                    return 5;
                }
            }
            tz += 1;
        }
        tx += 1;
    }
    0
}

#[no_mangle]
pub extern "C" fn fill_chunk(input: i32, output: i32, oy: i32) -> i32 {
    unsafe {
        for z in 0..32 {
            for x in 0..32 {
                for y in 0..32 {
                    store_u16(
                        output + (x + 32 * (z + 32 * y)) * 2,
                        column_voxel(input, 38, x, oy + y, z),
                    );
                }
            }
        }
    }
    0
}

// ---- W07 fluid -----------------------------------------------------------

#[inline(always)]
unsafe fn fluid_i32(offset: i32) -> i32 {
    load_u32(offset) as i32
}

#[inline(always)]
fn fluid_chunk_coord(value: i32) -> i32 {
    if value < 0 {
        (value - 31) / 32
    } else {
        value / 32
    }
}

unsafe fn fluid_address(x: i32, y: i32, z: i32) -> (i32, i32) {
    let cx = fluid_chunk_coord(x);
    let cy = fluid_chunk_coord(y);
    let cz = fluid_chunk_coord(z);
    for index in 0..fluid_i32(64) {
        let row = 1024 + index * 20;
        if fluid_i32(row) == cx && fluid_i32(row + 4) == cy && fluid_i32(row + 8) == cz {
            let local_index = (x - cx * 32) + 32 * ((z - cz * 32) + 32 * (y - cy * 32));
            return (
                fluid_i32(row + 12) + local_index * 2,
                fluid_i32(row + 16) + local_index,
            );
        }
    }
    store_u32(68, load_u32(68).wrapping_add(1));
    (-1, -1)
}

unsafe fn fluid_cell(x: i32, y: i32, z: i32) -> i32 {
    let (voxel_ptr, fluid_ptr) = fluid_address(x, y, z);
    if voxel_ptr < 0 {
        return -1;
    }
    let voxel = load_u16(voxel_ptr);
    let fluid = load_u8(fluid_ptr);
    let level = if voxel == 8 && fluid == 0 {
        0x88
    } else {
        fluid
    };
    (voxel | (level << 16)) as i32
}

#[inline(always)]
fn fluid_water(value: i32) -> bool {
    value >= 0 && (value & 65535) == 8
}

#[inline(always)]
fn fluid_level(value: i32) -> i32 {
    (value >> 16) & 15
}

unsafe fn fluid_activate(x: i32, y: i32, z: i32) {
    if y < 0 || y > 63 {
        return;
    }
    let count = fluid_i32(76);
    if count >= 16384 {
        store_u32(80, 1);
        return;
    }
    let row = 5 * 1024 * 1024 + count * 12;
    store_u32(row, x as u32);
    store_u32(row + 4, y as u32);
    store_u32(row + 8, z as u32);
    store_u32(76, (count + 1) as u32);
}

unsafe fn fluid_neighborhood(x: i32, y: i32, z: i32) {
    fluid_activate(x, y, z);
    fluid_activate(x, y - 1, z);
    fluid_activate(x, y + 1, z);
    fluid_activate(x - 1, y, z);
    fluid_activate(x + 1, y, z);
    fluid_activate(x, y, z - 1);
    fluid_activate(x, y, z + 1);
}

unsafe fn fluid_write(x: i32, y: i32, z: i32, voxel: u32, fluid: u32) {
    let (voxel_ptr, fluid_ptr) = fluid_address(x, y, z);
    if voxel_ptr < 0 {
        return;
    }
    let count = fluid_i32(72);
    let mut seen = false;
    for index in 0..count {
        if fluid_i32(4 * 1024 * 1024 + index * 24 + 16) == voxel_ptr {
            seen = true;
            break;
        }
    }
    if !seen {
        if count >= 2048 {
            store_u32(80, 1);
            return;
        }
        let row = 4 * 1024 * 1024 + count * 24;
        store_u32(row, x as u32);
        store_u32(row + 4, y as u32);
        store_u32(row + 8, z as u32);
        store_u32(row + 12, load_u16(voxel_ptr) | (load_u8(fluid_ptr) << 16));
        store_u32(row + 16, voxel_ptr as u32);
        store_u32(row + 20, fluid_ptr as u32);
        store_u32(72, (count + 1) as u32);
    }
    store_u16(voxel_ptr, voxel);
    store_u8(fluid_ptr, fluid);
}

unsafe fn fluid_place(x: i32, y: i32, z: i32, level: i32) {
    let (voxel_ptr, fluid_ptr) = fluid_address(x, y, z);
    if voxel_ptr < 0 {
        return;
    }
    let voxel = load_u16(voxel_ptr);
    if voxel != 0 && voxel != 8 {
        return;
    }
    let next = if level < 1 {
        1
    } else if level > 8 {
        8
    } else {
        level
    } as u32;
    if voxel == 8 && load_u8(fluid_ptr) == next {
        return;
    }
    fluid_write(x, y, z, 8, next);
    fluid_neighborhood(x, y, z);
}

#[inline(always)]
fn fluid_side(x: i32, z: i32, direction: i32) -> (i32, i32) {
    if direction == 0 {
        (x - 1, z)
    } else if direction == 1 {
        (x + 1, z)
    } else if direction == 2 {
        (x, z - 1)
    } else {
        (x, z + 1)
    }
}

#[no_mangle]
pub extern "C" fn fluid_candidate(count: i32) -> i32 {
    unsafe {
        if count < 0 || count > 192 || fluid_i32(64) < 0 || fluid_i32(64) > 32 {
            return 1;
        }
        for index in 0..count {
            let row = 8192 + index * 12;
            let x = fluid_i32(row);
            let y = fluid_i32(row + 4);
            let z = fluid_i32(row + 8);
            let current = fluid_cell(x, y, z);
            if !fluid_water(current) {
                continue;
            }
            let level = fluid_level(current);
            let source = (current & 0x800000) != 0;
            if !source {
                let unknown_before = load_u32(68);
                let above = fluid_cell(x, y + 1, z);
                let mut desired = 0;
                if fluid_water(above) {
                    desired = 8;
                } else {
                    for direction in 0..4 {
                        let (sx, sz) = fluid_side(x, z, direction);
                        let neighbor = fluid_cell(sx, y, sz);
                        if fluid_water(neighbor) && fluid_level(neighbor) - 1 > desired {
                            desired = fluid_level(neighbor) - 1;
                        }
                    }
                }
                let above_again = fluid_cell(x, y + 1, z);
                let mut stronger = false;
                for direction in 0..4 {
                    let (sx, sz) = fluid_side(x, z, direction);
                    let neighbor = fluid_cell(sx, y, sz);
                    if fluid_water(neighbor) && fluid_level(neighbor) > level {
                        stronger = true;
                        break;
                    }
                }
                if !fluid_water(above_again) && !stronger && desired > level - 1 {
                    desired = level - 1;
                }
                if desired < level && unknown_before != load_u32(68) {
                    fluid_activate(x, y, z);
                    continue;
                }
                if desired <= 0 {
                    fluid_write(x, y, z, 0, 0);
                    fluid_neighborhood(x, y, z);
                    continue;
                }
                if desired != level {
                    fluid_write(x, y, z, 8, desired as u32);
                    fluid_neighborhood(x, y, z);
                }
            }
            let below = fluid_cell(x, y - 1, z);
            if below < 0 {
                continue;
            }
            if (below & 65535) == 0 {
                fluid_place(x, y - 1, z, 8);
                fluid_activate(x, y, z);
                continue;
            }
            if fluid_water(below) {
                continue;
            }
            let settled = fluid_cell(x, y, z);
            let settled_level = if settled < 0 { 0 } else { fluid_level(settled) };
            if settled_level <= 1 {
                continue;
            }
            for direction in 0..4 {
                let (sx, sz) = fluid_side(x, z, direction);
                let target = fluid_cell(sx, y, sz);
                if target < 0 {
                    continue;
                }
                if (target & 65535) == 0
                    || (fluid_water(target)
                        && (target & 0x800000) == 0
                        && fluid_level(target) < settled_level - 1)
                {
                    fluid_place(sx, y, sz, settled_level - 1);
                }
            }
        }
        fluid_i32(80)
    }
}

// ---- W04 mesh descriptor -------------------------------------------------

const HALO_SIZE: i32 = 36;
const HALO_CELLS: i32 = 46656;
const MASK_BYTES: i32 = 6144;
const RECORD_BYTES: i32 = 16;
const MAX_DESCRIPTOR_RECORDS: i32 = 3 * 33 * 32 * 32 + 32 * 32 * 32;
const MAX_DESCRIPTOR_BYTES: i32 = MAX_DESCRIPTOR_RECORDS * RECORD_BYTES;

#[inline(always)]
fn halo_index(x: i32, y: i32, z: i32) -> i32 {
    x + 2 + HALO_SIZE * (z + 2 + HALO_SIZE * (y + 2))
}

#[inline(always)]
unsafe fn sample(halo: i32, x: i32, y: i32, z: i32) -> u32 {
    load_u16(halo + halo_index(x, y, z) * 2)
}

#[inline(always)]
unsafe fn sample_fluid(fluid: i32, x: i32, y: i32, z: i32) -> u32 {
    load_u8(fluid + halo_index(x, y, z))
}

#[inline(always)]
fn greedy(id: u32) -> bool {
    id != 0 && id != 10
}

#[inline(always)]
fn occludes(id: u32) -> bool {
    id != 0 && id != 8 && id != 10
}

#[inline(always)]
fn visible(source: u32, target: u32) -> bool {
    if !greedy(source) {
        return false;
    }
    if source == 8 {
        target == 0 || (target != 8 && !occludes(target))
    } else {
        target == 0 || target == 8 || !occludes(target)
    }
}

#[inline(always)]
fn material(id: u32, axis: i32, positive: bool) -> u32 {
    if id == 1 {
        return if axis == 1 {
            if positive {
                1
            } else {
                3
            }
        } else {
            2
        };
    }
    if id == 4 {
        return if axis == 1 { 7 } else { 6 };
    }
    if id == 2 {
        return 3;
    }
    if id == 3 {
        return 4;
    }
    if id == 5 {
        return 8;
    }
    if id == 6 {
        return 5;
    }
    if id == 7 {
        return 9;
    }
    if id == 8 {
        return 10;
    }
    if id == 9 {
        return 11;
    }
    if id == 10 {
        return 12;
    }
    255
}

#[inline(always)]
unsafe fn water_height_code(halo: i32, fluid: i32, x: i32, y: i32, z: i32) -> u32 {
    if sample(halo, x, y + 1, z) == 8 {
        return 9;
    }
    let mut level = sample_fluid(fluid, x, y, z) & 15;
    if level < 1 {
        level = 1;
    }
    if level > 8 {
        level = 8;
    }
    if level >= 7 {
        8
    } else {
        level
    }
}

#[inline(always)]
unsafe fn packed_ao(halo: i32, bx: i32, by: i32, bz: i32, axis: i32, back: bool) -> u32 {
    let normal = if back { -1 } else { 1 };
    let mut packed = 0;
    for corner in 0..4 {
        let (su, sv) = if back {
            if corner == 0 {
                (-1, -1)
            } else if corner == 1 {
                (-1, 1)
            } else if corner == 2 {
                (1, 1)
            } else {
                (1, -1)
            }
        } else {
            if corner == 0 {
                (-1, -1)
            } else if corner == 1 {
                (1, -1)
            } else if corner == 2 {
                (1, 1)
            } else {
                (-1, 1)
            }
        };
        let u = (axis + 1) % 3;
        let v = (axis + 2) % 3;
        let ox = if axis == 0 { bx + normal } else { bx };
        let oy = if axis == 1 { by + normal } else { by };
        let oz = if axis == 2 { bz + normal } else { bz };
        let ux = if u == 0 { ox + su } else { ox };
        let uy = if u == 1 { oy + su } else { oy };
        let uz = if u == 2 { oz + su } else { oz };
        let vx = if v == 0 { ox + sv } else { ox };
        let vy = if v == 1 { oy + sv } else { oy };
        let vz = if v == 2 { oz + sv } else { oz };
        let cx = if u == 0 {
            ox + su
        } else if v == 0 {
            ox + sv
        } else {
            ox
        };
        let cy = if u == 1 {
            oy + su
        } else if v == 1 {
            oy + sv
        } else {
            oy
        };
        let cz = if u == 2 {
            oz + su
        } else if v == 2 {
            oz + sv
        } else {
            oz
        };
        let occupied_u = occludes(sample(halo, ux, uy, uz));
        let occupied_v = occludes(sample(halo, vx, vy, vz));
        let level = if occupied_u && occupied_v {
            3
        } else {
            (if occupied_u { 1 } else { 0 })
                + (if occupied_v { 1 } else { 0 })
                + (if occludes(sample(halo, cx, cy, cz)) {
                    1
                } else {
                    0
                })
        };
        packed |= level << (corner * 2);
    }
    packed
}

#[inline(always)]
fn mask_offset(base: i32, index: i32) -> i32 {
    base + index * 6
}

unsafe fn write_mask(base: i32, index: i32, mat: u32, back: bool, ao: u32, high: u32, low: u32) {
    let offset = mask_offset(base, index);
    store_u8(offset, 1);
    store_u8(offset + 1, mat);
    store_u8(offset + 2, if back { 1 } else { 0 });
    store_u8(offset + 3, ao);
    store_u8(offset + 4, high);
    store_u8(offset + 5, low);
}

#[inline(always)]
unsafe fn same_mask(
    base: i32,
    index: i32,
    mat: u32,
    back: bool,
    ao: u32,
    high: u32,
    low: u32,
) -> bool {
    let offset = mask_offset(base, index);
    load_u8(offset) != 0
        && load_u8(offset + 1) == mat
        && load_u8(offset + 2) == if back { 1 } else { 0 }
        && load_u8(offset + 3) == ao
        && load_u8(offset + 4) == high
        && load_u8(offset + 5) == low
}

#[inline(always)]
unsafe fn clear_mask(base: i32, index: i32) {
    store_u8(mask_offset(base, index), 0);
}

unsafe fn write_quad(
    base: i32,
    count: i32,
    mat: u32,
    axis: i32,
    back: bool,
    x: i32,
    y: i32,
    z: i32,
    width: i32,
    height: i32,
    ao: u32,
    high: u32,
    low: u32,
) {
    let offset = base + MASK_BYTES + count * RECORD_BYTES;
    store_u8(offset, 0);
    store_u8(offset + 1, mat);
    store_u8(offset + 2, axis as u32);
    store_u8(offset + 3, if back { 1 } else { 0 });
    store_u8(offset + 4, x as u32);
    store_u8(offset + 5, y as u32);
    store_u8(offset + 6, z as u32);
    store_u8(offset + 7, width as u32);
    store_u8(offset + 8, height as u32);
    store_u8(offset + 9, ao);
    store_u8(offset + 10, high);
    store_u8(offset + 11, low);
    store_u32(offset + 12, 0);
}

unsafe fn write_lantern(base: i32, count: i32, x: i32, y: i32, z: i32) {
    let offset = base + MASK_BYTES + count * RECORD_BYTES;
    store_u8(offset, 1);
    store_u8(offset + 1, x as u32);
    store_u8(offset + 2, y as u32);
    store_u8(offset + 3, z as u32);
    store_u32(offset + 4, 0);
    store_u32(offset + 8, 0);
    store_u32(offset + 12, 0);
}

#[inline(always)]
fn coordinates(axis: i32, slice: i32, i: i32, j: i32) -> (i32, i32, i32) {
    if axis == 0 {
        (slice, i, j)
    } else if axis == 1 {
        (j, slice, i)
    } else {
        (i, j, slice)
    }
}

unsafe fn descriptor_pass(halo: i32, fluid: i32, output: i32, write: bool) -> i32 {
    let mask = output;
    let mut count = 0;
    for axis in 0..3 {
        for slice in -1..32 {
            let mut m = 0;
            for j in 0..32 {
                for i in 0..32 {
                    let (x, y, z) = coordinates(axis, slice, i, j);
                    let (nx, ny, nz) = coordinates(axis, slice + 1, i, j);
                    let a = sample(halo, x, y, z);
                    let b = sample(halo, nx, ny, nz);
                    let ah = if a == 8 {
                        water_height_code(halo, fluid, x, y, z)
                    } else {
                        0
                    };
                    let bh = if b == 8 {
                        water_height_code(halo, fluid, nx, ny, nz)
                    } else {
                        0
                    };
                    let stepped = axis != 1 && a == 8 && b == 8 && ah != bh;
                    let forward = if stepped { ah > bh } else { visible(a, b) };
                    let back = if stepped {
                        bh > ah
                    } else {
                        !forward && visible(b, a)
                    };
                    if !forward && !back {
                        clear_mask(mask, m);
                    } else {
                        let id = if back { b } else { a };
                        let (bx, by, bz) = if back {
                            coordinates(axis, slice + 1, i, j)
                        } else {
                            (x, y, z)
                        };
                        let ao = if id == 8 {
                            0
                        } else {
                            packed_ao(halo, bx, by, bz, axis, back)
                        };
                        let high = if id == 8 {
                            if stepped {
                                if ah > bh {
                                    ah
                                } else {
                                    bh
                                }
                            } else if back {
                                bh
                            } else {
                                ah
                            }
                        } else {
                            0
                        };
                        let low = if stepped {
                            if ah < bh {
                                ah
                            } else {
                                bh
                            }
                        } else {
                            0
                        };
                        write_mask(mask, m, material(id, axis, !back), back, ao, high, low);
                    }
                    m += 1;
                }
            }
            m = 0;
            for j in 0..32 {
                let mut i = 0;
                while i < 32 {
                    let offset = mask_offset(mask, m);
                    if load_u8(offset) == 0 {
                        i += 1;
                        m += 1;
                    } else {
                        let mat = load_u8(offset + 1);
                        let back = load_u8(offset + 2) != 0;
                        let ao = load_u8(offset + 3);
                        let high = load_u8(offset + 4);
                        let low = load_u8(offset + 5);
                        let mut width = 1;
                        while i + width < 32 && same_mask(mask, m + width, mat, back, ao, high, low)
                        {
                            width += 1;
                        }
                        let mut height = 1;
                        let mut keep = true;
                        while j + height < 32 && keep {
                            for column in 0..width {
                                if !same_mask(
                                    mask,
                                    m + column + height * 32,
                                    mat,
                                    back,
                                    ao,
                                    high,
                                    low,
                                ) {
                                    keep = false;
                                }
                            }
                            if keep {
                                height += 1;
                            }
                        }
                        let (px, py, pz) = coordinates(axis, slice + 1, i, j);
                        if write {
                            write_quad(
                                output, count, mat, axis, back, px, py, pz, width, height, ao,
                                high, low,
                            );
                        }
                        for row in 0..height {
                            for column in 0..width {
                                clear_mask(mask, m + column + row * 32);
                            }
                        }
                        count += 1;
                        i += width;
                        m += width;
                    }
                }
            }
        }
    }
    for y in 0..32 {
        for z in 0..32 {
            for x in 0..32 {
                if sample(halo, x, y, z) == 10 {
                    if write {
                        write_lantern(output, count, x, y, z);
                    }
                    count += 1;
                }
            }
        }
    }
    count
}

#[no_mangle]
pub extern "C" fn mesh_describe(halo: i32, fluid: i32, output: i32, capacity: i32) -> i32 {
    unsafe {
        if halo < MESH_ARENA_START
            || fluid < MESH_ARENA_START
            || output < MESH_ARENA_START
            || halo % 2 != 0
            || capacity < 0
        {
            return -1;
        }
        if halo > MESH_ARENA_LIMIT - HALO_CELLS * 2
            || fluid > MESH_ARENA_LIMIT - HALO_CELLS
            || output > MESH_ARENA_LIMIT - MASK_BYTES
        {
            return -1;
        }
        if capacity > MESH_ARENA_LIMIT - output - MASK_BYTES {
            return -1;
        }
        if !(output + MASK_BYTES <= halo || output >= halo + HALO_CELLS * 2) {
            return -1;
        }
        if !(output + MASK_BYTES <= fluid || output >= fluid + HALO_CELLS) {
            return -1;
        }
        if capacity >= MAX_DESCRIPTOR_BYTES {
            return descriptor_pass(halo, fluid, output, true) * RECORD_BYTES;
        }
        let count = descriptor_pass(halo, fluid, output, false);
        if count > capacity / RECORD_BYTES {
            return -2;
        }
        descriptor_pass(halo, fluid, output, true) * RECORD_BYTES
    }
}
