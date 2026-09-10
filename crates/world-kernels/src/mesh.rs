pub const HALO_SIZE: usize = 36;
pub const HALO_CELLS: usize = HALO_SIZE * HALO_SIZE * HALO_SIZE;
pub const MASK_BYTES: usize = 6_144;
pub const RECORD_BYTES: usize = 16;
pub const MAX_DESCRIPTOR_RECORDS: usize = 3 * 33 * 32 * 32 + 32 * 32 * 32;
pub const MAX_DESCRIPTOR_BYTES: usize = MAX_DESCRIPTOR_RECORDS * RECORD_BYTES;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MeshError {
    InvalidInput,
    Capacity,
}

fn halo_index(x: i32, y: i32, z: i32) -> usize {
    (x + 2 + HALO_SIZE as i32 * (z + 2 + HALO_SIZE as i32 * (y + 2))) as usize
}

fn sample(halo: &[u16], x: i32, y: i32, z: i32) -> u32 {
    halo[halo_index(x, y, z)] as u32
}

fn sample_fluid(fluid: &[u8], x: i32, y: i32, z: i32) -> u32 {
    fluid[halo_index(x, y, z)] as u32
}

fn greedy(id: u32) -> bool {
    id != 0 && id != 10
}

fn occludes(id: u32) -> bool {
    id != 0 && id != 8 && id != 10
}

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

fn material(id: u32, axis: i32, positive: bool) -> u32 {
    if id == 1 {
        return if axis == 1 {
            if positive { 1 } else { 3 }
        } else {
            2
        };
    }
    if id == 4 {
        return if axis == 1 { 7 } else { 6 };
    }
    match id {
        2 => 3,
        3 => 4,
        5 => 8,
        6 => 5,
        7 => 9,
        8 => 10,
        9 => 11,
        10 => 12,
        11 => 14,
        12 => 15,
        13 => 16,
        14 => 17,
        15 => 18,
        _ => 255,
    }
}

fn water_height_code(halo: &[u16], fluid: &[u8], x: i32, y: i32, z: i32) -> u32 {
    if sample(halo, x, y + 1, z) == 8 {
        return 9;
    }
    let level = (sample_fluid(fluid, x, y, z) & 15).clamp(1, 8);
    if level >= 7 { 8 } else { level }
}

fn packed_ao(halo: &[u16], bx: i32, by: i32, bz: i32, axis: i32, back: bool) -> u32 {
    let normal = if back { -1 } else { 1 };
    let mut packed = 0;
    for corner in 0..4 {
        let (su, sv) = if back {
            match corner {
                0 => (-1, -1),
                1 => (-1, 1),
                2 => (1, 1),
                _ => (1, -1),
            }
        } else {
            match corner {
                0 => (-1, -1),
                1 => (1, -1),
                2 => (1, 1),
                _ => (-1, 1),
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
            u32::from(occupied_u) + u32::from(occupied_v) + u32::from(occludes(sample(halo, cx, cy, cz)))
        };
        packed |= level << (corner * 2);
    }
    packed
}

fn mask_offset(index: i32) -> usize {
    index as usize * 6
}

fn write_mask(mask: &mut [u8], index: i32, mat: u32, back: bool, ao: u32, high: u32, low: u32) {
    let offset = mask_offset(index);
    mask[offset] = 1;
    mask[offset + 1] = mat as u8;
    mask[offset + 2] = u8::from(back);
    mask[offset + 3] = ao as u8;
    mask[offset + 4] = high as u8;
    mask[offset + 5] = low as u8;
}

fn same_mask(mask: &[u8], index: i32, mat: u32, back: bool, ao: u32, high: u32, low: u32) -> bool {
    let offset = mask_offset(index);
    mask[offset] != 0
        && mask[offset + 1] == mat as u8
        && mask[offset + 2] == u8::from(back)
        && mask[offset + 3] == ao as u8
        && mask[offset + 4] == high as u8
        && mask[offset + 5] == low as u8
}

fn clear_mask(mask: &mut [u8], index: i32) {
    mask[mask_offset(index)] = 0;
}

#[allow(clippy::too_many_arguments)]
fn write_quad(
    output: &mut [u8],
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
    let offset = count as usize * RECORD_BYTES;
    output[offset] = 0;
    output[offset + 1] = mat as u8;
    output[offset + 2] = axis as u8;
    output[offset + 3] = u8::from(back);
    output[offset + 4] = x as u8;
    output[offset + 5] = y as u8;
    output[offset + 6] = z as u8;
    output[offset + 7] = width as u8;
    output[offset + 8] = height as u8;
    output[offset + 9] = ao as u8;
    output[offset + 10] = high as u8;
    output[offset + 11] = low as u8;
    output[offset + 12..offset + RECORD_BYTES].fill(0);
}

fn write_lantern(output: &mut [u8], count: i32, x: i32, y: i32, z: i32) {
    let offset = count as usize * RECORD_BYTES;
    output[offset] = 1;
    output[offset + 1] = x as u8;
    output[offset + 2] = y as u8;
    output[offset + 3] = z as u8;
    output[offset + 4..offset + RECORD_BYTES].fill(0);
}

fn coordinates(axis: i32, slice: i32, i: i32, j: i32) -> (i32, i32, i32) {
    if axis == 0 {
        (slice, i, j)
    } else if axis == 1 {
        (j, slice, i)
    } else {
        (i, j, slice)
    }
}

fn descriptor_pass(halo: &[u16], fluid: &[u8], mask: &mut [u8], output: &mut [u8], write: bool) -> usize {
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
                    let back = if stepped { bh > ah } else { !forward && visible(b, a) };
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
                                if ah > bh { ah } else { bh }
                            } else if back {
                                bh
                            } else {
                                ah
                            }
                        } else {
                            0
                        };
                        let low = if stepped {
                            if ah < bh { ah } else { bh }
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
                    let offset = mask_offset(m);
                    if mask[offset] == 0 {
                        i += 1;
                        m += 1;
                    } else {
                        let mat = mask[offset + 1] as u32;
                        let back = mask[offset + 2] != 0;
                        let ao = mask[offset + 3] as u32;
                        let high = mask[offset + 4] as u32;
                        let low = mask[offset + 5] as u32;
                        let mut width = 1;
                        while i + width < 32 && same_mask(mask, m + width, mat, back, ao, high, low) {
                            width += 1;
                        }
                        let mut height = 1;
                        let mut keep = true;
                        while j + height < 32 && keep {
                            for column in 0..width {
                                if !same_mask(mask, m + column + height * 32, mat, back, ao, high, low) {
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
                                output, count, mat, axis, back, px, py, pz, width, height, ao, high, low,
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
    count as usize
}

pub fn mesh_describe(
    halo: &[u16],
    fluid: &[u8],
    mask: &mut [u8],
    output: &mut [u8],
) -> Result<usize, MeshError> {
    if halo.len() != HALO_CELLS || fluid.len() != HALO_CELLS || mask.len() < MASK_BYTES {
        return Err(MeshError::InvalidInput);
    }
    if output.len() >= MAX_DESCRIPTOR_BYTES {
        return Ok(descriptor_pass(halo, fluid, mask, output, true) * RECORD_BYTES);
    }
    let count = descriptor_pass(halo, fluid, mask, output, false);
    if count > output.len() / RECORD_BYTES {
        return Err(MeshError::Capacity);
    }
    Ok(descriptor_pass(halo, fluid, mask, output, true) * RECORD_BYTES)
}

#[cfg(test)]
mod tests {
    use super::material;

    #[test]
    fn progression_voxels_keep_their_frozen_material_ids() {
        assert_eq!(material(11, 0, true), 14);
        assert_eq!(material(12, 1, false), 15);
        assert_eq!(material(13, 2, true), 16);
        assert_eq!(material(14, 0, false), 17);
        assert_eq!(material(15, 1, true), 18);
    }
}
