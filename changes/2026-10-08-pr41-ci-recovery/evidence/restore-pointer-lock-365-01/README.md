# Restore Pointer Lock 365

CI433 retry completed C4 outbound/return, then the first crop movement after Continue World failed because the canvas had no Pointer Lock. The restored portable journey now calls the existing real canvas acquisition helper before movement. Route, physics, deadlines and assertions are unchanged.

Three added regressions use the actual mouse-input helper and its retained baseline: released lock, existing lock, and acquisition failure. Original code failed two cases; the fix passes all seven tests in the existing selected owner. This is an input-boundary unit result; a new exact-SHA complete browser journey is still required.

The baseline local main and renderer diagnostic both exceeded the original 900000ms main deadline. Renderer profile time validation failed on two signed negative deltas; failure and raw data are retained. Sample counts are diagnostic only. Full transport acceptance and combined end-to-end performance evidence remain open; this receipt does not claim merge readiness.
