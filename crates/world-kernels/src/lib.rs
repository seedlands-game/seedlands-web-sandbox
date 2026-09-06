#![no_std]

/// Pure deterministic data-plane kernels. No host objects, global arena or I/O.
pub mod pack;

pub fn occupancy(input: &[u16], output: &mut [u8]) {
    assert_eq!(input.len(), output.len());
    for (source, target) in input.iter().zip(output.iter_mut()) {
        *target = u8::from(*source != 0 && *source != 8);
    }
}
