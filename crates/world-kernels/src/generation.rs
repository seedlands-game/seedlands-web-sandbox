#[inline(always)]
fn column_voxel(columns: &[i32], grid: i32, x: i32, y: i64, z: i32) -> u32 {
    let column = ((x + 3) + grid * (z + 3)) * 4;
    let height = i64::from(columns[(column) as usize]);
    let kind = columns[(column + 1) as usize];
    let water_level = i64::from(columns[(column + 2) as usize]);
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
    assert_eq!(columns.len(), 38 * 38 * 4);
    assert_eq!(output.len(), 32 * 32 * 32);
    for z in 0..32 { for x in 0..32 { for y in 0..32 {
        output[(x + 32 * (z + 32 * y)) as usize] = column_voxel(columns, 38, x, i64::from(oy) + i64::from(y), z) as u16;
    }}}
}

pub fn fill_halo(columns: &[i32], known: &[u32], halo: &mut [u16], fluid: &mut [u8], oy: i32) -> u32 {
    assert_eq!(columns.len(),40*40*4);
    assert_eq!(known.len(),34*34*34); assert_eq!(halo.len(),known.len()); assert_eq!(fluid.len(),known.len());
    let mut revision = 2166136261u32;
    for y in 0..34 { for z in 0..34 { for x in 0..34 {
        let index=(x+34*(z+34*y)) as usize;
        let packed=known[index];
        let value=if packed==u32::MAX { column_voxel(columns,40,x,i64::from(oy)+i64::from(y),z) as u16 } else {packed as u16};
        halo[index]=value;
        fluid[index]=if packed==u32::MAX {if value==8 {0x88} else {0}} else {(packed>>16) as u8};
        revision=(revision ^ value as u32).wrapping_mul(16777619);
    }}}
    revision
}
