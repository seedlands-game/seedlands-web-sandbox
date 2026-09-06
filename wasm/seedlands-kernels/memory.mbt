///|
#inline
extern "wasm" fn load_u8(offset : Int) -> UInt =
  #|(func (param i32) (result i32) local.get 0 i32.load8_u)

///|
#inline
extern "wasm" fn load_u16(offset : Int) -> UInt =
  #|(func (param i32) (result i32) local.get 0 i32.load16_u)

///|
#inline
extern "wasm" fn load_u32(offset : Int) -> UInt =
  #|(func (param i32) (result i32) local.get 0 i32.load)

///|
#inline
extern "wasm" fn store_u8(offset : Int, value : UInt) -> Unit =
  #|(func (param i32 i32) local.get 0 local.get 1 i32.store8)

///|
#inline
extern "wasm" fn store_u16(offset : Int, value : UInt) -> Unit =
  #|(func (param i32 i32) local.get 0 local.get 1 i32.store16)

///|
#inline
extern "wasm" fn store_u32(offset : Int, value : UInt) -> Unit =
  #|(func (param i32 i32) local.get 0 local.get 1 i32.store)

///|
#inline
extern "wasm" fn load_f64(offset : Int) -> Double =
  #|(func (param i32) (result f64) local.get 0 f64.load)

///|
#inline
extern "wasm" fn store_f64(offset : Int, value : Double) -> Unit =
  #|(func (param i32 f64) local.get 0 local.get 1 f64.store)

///|
pub fn abi_version() -> Int {
  1
}

///|
pub fn arena_bytes() -> Int {
  16777216
}
