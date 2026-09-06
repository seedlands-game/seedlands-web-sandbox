use world_kernels::{
    fluid::{fluid_candidate, FluidChunkLayout, FluidError, FluidPosition, FluidScratch, FluidWrite},
    mesh::{mesh_describe, MeshError, HALO_CELLS, MASK_BYTES},
};

const CHUNK_CELLS: usize = 32 * 32 * 32;

fn index(x: usize, y: usize, z: usize) -> usize {
    x + 32 * (z + 32 * y)
}

fn set_voxel(arena: &mut [u8], offset: usize, index: usize, voxel: u16) {
    arena[offset + index * 2..offset + index * 2 + 2].copy_from_slice(&voxel.to_le_bytes());
}

#[test]
fn fluid_source_spreads_with_reference_order_and_caller_scratch() {
    let voxel_offset = 0;
    let fluid_offset = CHUNK_CELLS * 2;
    let mut arena = vec![0; fluid_offset + CHUNK_CELLS];
    let source = index(10, 10, 10);
    set_voxel(&mut arena, voxel_offset, source, 8);
    arena[fluid_offset + source] = 0x88;
    set_voxel(&mut arena, voxel_offset, index(10, 9, 10), 3);
    let chunks = [FluidChunkLayout {
        cx: 0,
        cy: 0,
        cz: 0,
        voxel_offset,
        fluid_offset,
    }];
    let frontier = [FluidPosition::new(10, 10, 10)];
    let mut writes = [FluidWrite::EMPTY; 2_048];
    let mut next = [FluidPosition::ZERO; 16_384];
    let mut scratch = FluidScratch::new(&mut writes, &mut next);

    let outcome = fluid_candidate(&mut arena, &chunks, &frontier, &mut scratch).unwrap();

    assert_eq!(outcome.write_count, 4);
    assert_eq!(outcome.next_count, 28);
    assert_eq!(outcome.unknown_count, 0);
    assert!(!outcome.needs_rescan);
    assert_eq!(
        scratch.writes()[..outcome.write_count]
            .iter()
            .map(|write| write.position)
            .collect::<Vec<_>>(),
        vec![
            FluidPosition::new(9, 10, 10),
            FluidPosition::new(11, 10, 10),
            FluidPosition::new(10, 10, 9),
            FluidPosition::new(10, 10, 11),
        ]
    );
    for position in scratch.writes()[..outcome.write_count]
        .iter()
        .map(|write| write.position)
    {
        let target = index(position.x as usize, position.y as usize, position.z as usize);
        assert_eq!(u16::from_le_bytes([arena[target * 2], arena[target * 2 + 1]]), 8);
        assert_eq!(arena[fluid_offset + target], 7);
    }
}

#[test]
fn mesh_descriptor_matches_single_cube_record_shape_and_capacity_rule() {
    let mut halo = vec![0u16; HALO_CELLS];
    let fluid = vec![0u8; HALO_CELLS];
    let halo_index = |x: usize, y: usize, z: usize| x + 2 + 36 * (z + 2 + 36 * (y + 2));
    halo[halo_index(16, 8, 16)] = 3;
    let mut mask = vec![0; MASK_BYTES];
    let mut descriptors = vec![0; 6 * 16];

    let length = mesh_describe(&halo, &fluid, &mut mask, &mut descriptors).unwrap();

    assert_eq!(length, 6 * 16);
    for record in descriptors[..length].chunks_exact(16) {
        assert_eq!(record[0], 0);
        assert_eq!(record[1], 4);
        assert!(record[2] <= 2);
        assert!(record[3] <= 1);
        assert_eq!(&record[12..16], &[0, 0, 0, 0]);
    }

    let mut short = vec![0; length - 1];
    assert_eq!(mesh_describe(&halo, &fluid, &mut mask, &mut short), Err(MeshError::Capacity));
}

#[test]
fn malformed_fluid_inputs_are_rejected_before_access() {
    let chunks=[FluidChunkLayout {cx:0,cy:0,cz:0,voxel_offset:0,fluid_offset:0}];
    let mut writes=[FluidWrite::EMPTY;2];let mut next=[FluidPosition::ZERO;8];
    let mut scratch=FluidScratch::new(&mut writes,&mut next);
    assert!(fluid_candidate(&mut [0;8],&chunks,&[FluidPosition::new(10,10,10)],&mut scratch).is_err());
    let mut arena=vec![0;CHUNK_CELLS*3];
    assert!(fluid_candidate(&mut arena,&chunks,&[FluidPosition::new(i32::MIN,0,0)],&mut scratch).is_err());
}

fn expect_invalid_fluid_layout(arena_bytes: usize, chunks: &[FluidChunkLayout]) {
    let mut arena = vec![0; arena_bytes];
    let mut writes = [FluidWrite::EMPTY; 2];
    let mut next = [FluidPosition::ZERO; 8];
    let mut scratch = FluidScratch::new(&mut writes, &mut next);
    assert_eq!(
        fluid_candidate(&mut arena, chunks, &[], &mut scratch),
        Err(FluidError::InvalidLayout)
    );
}

#[test]
fn fluid_rejects_aliased_ranges_and_duplicate_chunk_coordinates() {
    expect_invalid_fluid_layout(
        CHUNK_CELLS * 3,
        &[FluidChunkLayout {
            cx: 0,
            cy: 0,
            cz: 0,
            voxel_offset: 0,
            fluid_offset: 0,
        }],
    );

    expect_invalid_fluid_layout(
        CHUNK_CELLS * 4,
        &[
            FluidChunkLayout {
                cx: 0,
                cy: 0,
                cz: 0,
                voxel_offset: 0,
                fluid_offset: CHUNK_CELLS * 2,
            },
            FluidChunkLayout {
                cx: 1,
                cy: 0,
                cz: 0,
                voxel_offset: CHUNK_CELLS,
                fluid_offset: CHUNK_CELLS * 3,
            },
        ],
    );

    expect_invalid_fluid_layout(
        CHUNK_CELLS * 6,
        &[
            FluidChunkLayout {
                cx: 0,
                cy: 0,
                cz: 0,
                voxel_offset: 0,
                fluid_offset: CHUNK_CELLS * 2,
            },
            FluidChunkLayout {
                cx: 0,
                cy: 0,
                cz: 0,
                voxel_offset: CHUNK_CELLS * 3,
                fluid_offset: CHUNK_CELLS * 5,
            },
        ],
    );
}
