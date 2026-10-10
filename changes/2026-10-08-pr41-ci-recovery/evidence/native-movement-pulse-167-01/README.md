# Native movement pulse 167

The installed Playwright 1.62.1 chord implementation awaits each key command before starting its requested delay and before releasing the remaining keys. This helper queues native down requests together and queues all up requests at the existing pulse deadline, independently of pending command acknowledgements. It waits for all commands and propagates failure after attempting every release. The deadline covers requests, not actual DOM held time under renderer blockage.

The prior sequential implementation failed all four delayed-acknowledgement/cleanup fixtures. The new helper passes those cases. Two press-only route mocks initially failed; they now model native down/up with the original physics and arrival assertions. Eleven files pass 79 unique tests, including the four new cases; Classic types, changed-file lint and 17 CI selection contracts pass.

The original ordinary minecart scenario adds a native W+Space pulse on its existing floor, requiring actual movement, an acknowledged neutral release, settling and the original floor height. All original minecart operations and route/main deadlines remain. Browser 168 and full main 169 have not run at this snapshot. This is not a playability or performance acceptance. Raw negative and positive evidence hashes are in validation.json.
