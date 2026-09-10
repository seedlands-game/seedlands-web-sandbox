const COAL_ORE_SALT: u32 = 0x434f_414c;
const IRON_ORE_SALT: u32 = 0x4952_4f4e;

// Frozen unsigned 32-bit mix shared byte-for-byte with game-core/ore-generation.ts.
// Coordinates are 2x2x2 group coordinates, represented with two's-complement u32 lanes.
#[inline(always)]
fn ore_hash(seed: u32, group_x: i32, group_y: i32, group_z: i32, salt: u32) -> u32 {
    let mut hash = seed
        ^ salt
        ^ (group_x as u32).wrapping_mul(0x9e37_79b1)
        ^ (group_y as u32).wrapping_mul(0x85eb_ca77)
        ^ (group_z as u32).wrapping_mul(0xc2b2_ae3d);
    hash = (hash ^ (hash >> 16)).wrapping_mul(0x7feb_352d);
    hash = (hash ^ (hash >> 15)).wrapping_mul(0x846c_a68b);
    hash ^ (hash >> 16)
}

#[inline(always)]
fn ore_voxel(seed: u32, x: i32, y: i64, z: i32, height: i64, base: u32, generator_version: u32) -> u32 {
    if generator_version < 4 || base != 3 {
        return base;
    }
    let group_x = x.div_euclid(2);
    let group_y = (y.div_euclid(2)) as i32;
    let group_z = z.div_euclid(2);
    let depth = height - y;
    if depth >= 8 && ore_hash(seed, group_x, group_y, group_z, IRON_ORE_SALT) % 97 < 6 {
        return 15;
    }
    if depth >= 4 && ore_hash(seed, group_x, group_y, group_z, COAL_ORE_SALT) % 97 < 10 {
        return 14;
    }
    base
}

#[inline(always)]
fn column_voxel(
    columns: &[i32],
    grid: i32,
    x: i32,
    y: i64,
    z: i32,
    seed: u32,
    world_x: i32,
    world_z: i32,
    generator_version: u32,
) -> u32 {
    let column = ((x + 3) + grid * (z + 3)) * 4;
    let height = i64::from(columns[(column) as usize]);
    let kind = columns[(column + 1) as usize];
    let water_level = i64::from(columns[(column + 2) as usize]);
    if y > height && y <= water_level {
        return 8;
    }
    if y <= height {
        let base = if y == height {
            if kind == 3 {
                6
            } else if kind == 4 {
                7
            } else if kind == 2 {
                3
            } else {
                1
            }
        } else if y > height - 4 {
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
        return ore_voxel(seed, world_x, y, world_z, height, base, generator_version);
    }
    let mut tx = x;
    while tx <= x + 6 {
        let mut tz = z;
        while tz <= z + 6 {
            let tree_column = (tx + grid * tz) * 4;
            if columns[(tree_column + 3) as usize] != 0 {
                let th = i64::from(columns[(tree_column) as usize]);
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

pub fn fill_chunk(columns: &[i32], output: &mut [u16], oy: i32) {
    fill_chunk_versioned(columns, output, 0, 0, oy, 0, 3);
}

pub fn fill_chunk_versioned(
    columns: &[i32],
    output: &mut [u16],
    seed: u32,
    ox: i32,
    oy: i32,
    oz: i32,
    generator_version: u32,
) {
    assert_eq!(columns.len(), 38 * 38 * 4);
    assert_eq!(output.len(), 32 * 32 * 32);
    for z in 0..32 { for x in 0..32 { for y in 0..32 {
        output[(x + 32 * (z + 32 * y)) as usize] = column_voxel(
            columns,
            38,
            x,
            i64::from(oy) + i64::from(y),
            z,
            seed,
            ox.wrapping_add(x),
            oz.wrapping_add(z),
            generator_version,
        ) as u16;
    }}}
}

pub fn fill_halo(columns: &[i32], known: &[u32], halo: &mut [u16], fluid: &mut [u8], oy: i32) -> u32 {
    fill_halo_versioned(columns, known, halo, fluid, 0, 0, oy, 0, 3)
}

pub fn fill_halo_versioned(
    columns: &[i32],
    known: &[u32],
    halo: &mut [u16],
    fluid: &mut [u8],
    seed: u32,
    ox: i32,
    oy: i32,
    oz: i32,
    generator_version: u32,
) -> u32 {
    assert_eq!(columns.len(),40*40*4);
    assert_eq!(known.len(),34*34*34); assert_eq!(halo.len(),known.len()); assert_eq!(fluid.len(),known.len());
    let mut revision = 2166136261u32;
    for y in 0..34 { for z in 0..34 { for x in 0..34 {
        let index=(x+34*(z+34*y)) as usize;
        let packed=known[index];
        let value=if packed==u32::MAX {
            column_voxel(
                columns,
                40,
                x,
                i64::from(oy)+i64::from(y),
                z,
                seed,
                ox.wrapping_add(x),
                oz.wrapping_add(z),
                generator_version,
            ) as u16
        } else {packed as u16};
        halo[index]=value;
        fluid[index]=if packed==u32::MAX {if value==8 {0x88} else {0}} else {(packed>>16) as u8};
        revision=(revision ^ value as u32).wrapping_mul(16777619);
    }}}
    revision
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ore_hash_vectors_include_negative_groups() {
        assert_eq!(ore_hash(0, 0, 0, 0, COAL_ORE_SALT), 686_038_650);
        assert_eq!(ore_hash(1837, 4, -9, 12, COAL_ORE_SALT), 2_132_735_606);
        assert_eq!(ore_hash(u32::MAX, -1, -1, -1, IRON_ORE_SALT), 2_792_393_888);
        assert_eq!(ore_hash(0x8000_0000, -1_234_567, 765_432, -42, IRON_ORE_SALT), 3_339_286_873);
    }

    #[test]
    fn versioned_fill_only_changes_deep_stone_in_v4() {
        let mut columns = [0i32; 38 * 38 * 4];
        for column in columns.chunks_mut(4) {
            column[0] = 20;
            column[2] = i32::MIN;
        }
        let mut v3 = [0u16; 32 * 32 * 32];
        let mut v4 = [0u16; 32 * 32 * 32];
        fill_chunk_versioned(&columns, &mut v3, 1837, -32, -32, 0, 3);
        fill_chunk_versioned(&columns, &mut v4, 1837, -32, -32, 0, 4);
        assert!(v3.iter().all(|voxel| *voxel <= 10));
        assert!(v4.iter().any(|voxel| *voxel == 14));
        assert!(v4.iter().any(|voxel| *voxel == 15));
        for (before, after) in v3.iter().zip(v4.iter()) {
            if before != after {
                assert_eq!(*before, 3);
                assert!(*after == 14 || *after == 15);
            }
        }
    }

    #[test]
    fn versioned_halo_preserves_known_cells_and_generates_v4_unknown_cells() {
        const N: usize = 34 * 34 * 34;
        let mut columns = [0i32; 40 * 40 * 4];
        for column in columns.chunks_mut(4) {
            column[0] = 20;
            column[2] = i32::MIN;
        }
        let mut known = [u32::MAX; N];
        known[0] = 12 | (5 << 16);
        let mut halo = [0u16; N];
        let mut fluid = [0u8; N];
        let revision = fill_halo_versioned(
            &columns,
            &known,
            &mut halo,
            &mut fluid,
            1837,
            -33,
            -33,
            -1,
            4,
        );
        assert_eq!(halo[0], 12);
        assert_eq!(fluid[0], 5);
        assert!(halo.iter().any(|voxel| *voxel == 14));
        assert!(halo.iter().any(|voxel| *voxel == 15));
        assert_ne!(revision, 2_166_136_261);
    }
}
