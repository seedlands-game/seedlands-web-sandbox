use world_kernels::{codec, generation};
#[test] fn known_answers_and_bounds() {
    assert_eq!(codec::crc32(b"123456789"), 0xcbf43926);
    assert_eq!(codec::crc32_u16(&[0x3231,0x3433]), codec::crc32(b"1234"));
    let mut out=[0u8;32];
    assert_eq!(codec::diff(&[1,2,3], &[1,0,3], &mut out), Some(7));
    assert_eq!(&out[..7], &[1,0,0,0,1,2,0]);
    assert_eq!(codec::diff(&[1], &[0], &mut [0;4]), None);
    assert_eq!(codec::raw(&[0x1234], &mut out), Some(2));
    assert_eq!(&out[..2], &[0x34,0x12]);
    let mut indexes=[0;65536];
    assert_eq!(codec::palette(&[9,8,9,8], &mut out, &mut indexes),Some(10));
    assert_eq!(&out[..10], &[2,0,0,0,1,9,0,8,0,10]);
}
#[test] fn flat_column_chunk() {
    let mut columns=[0i32;38*38*4];
    for c in columns.chunks_mut(4) { c[0]=10; c[2]=i32::MIN; }
    let mut out=[0u16;32768]; generation::fill_chunk(&columns,&mut out,0);
    assert_eq!(out[0],3); assert_eq!(out[32*32*10],1); assert_eq!(out[32*32*11],0);
}

#[test]
fn generation_uses_number_semantics_for_extreme_i32_inputs() {
    let mut columns = [0i32; 38 * 38 * 4];
    for column in columns.chunks_mut(4) {
        column[0] = i32::MIN + 1;
        column[2] = i32::MIN;
    }
    let mut output = [0u16; 32 * 32 * 32];

    generation::fill_chunk(&columns, &mut output, i32::MIN);

    // Number arithmetic keeps MIN + 1 - 4 below i32::MIN, so this cell is
    // within the four-block surface layer instead of wrapping to deep stone.
    assert_eq!(output[0], 2);
    assert_eq!(output[32 * 32], 1);

    for column in columns.chunks_mut(4) {
        column[0] = i32::MIN;
        column[3] = 0;
    }
    let overflowing_tree = (2 + 38 * 3) * 4;
    columns[overflowing_tree] = i32::MAX;
    columns[overflowing_tree + 3] = 1;

    generation::fill_chunk(&columns, &mut output, i32::MIN);

    // A neighboring tree at MAX height cannot cover a cell near MIN height;
    // th + 3..6 must not wrap into the negative range.
    assert_eq!(output[32 * 32 * 4], 0);
}
