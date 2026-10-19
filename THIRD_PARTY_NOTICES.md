# Third-party notices

Kitlibre's own code is MIT-licensed (see `LICENSE`). The site also bundles or serves these third-party components.

## Background remover (`/remove-bg/`, `/it/rimuovi-sfondo/`)

### ormbg (Open Remove Background Model), int8 quantized ONNX
- Author: Marvin Schirrmacher, https://huggingface.co/schirrmacher/ormbg (ONNX export: https://huggingface.co/onnx-community/ormbg-ONNX)
- Licence: **Apache-2.0** (full text: `licenses/Apache-2.0.txt`)
- File: `onnx/model_quantized.onnx`, pinned to revision `034e2d884afbab897e10e78fc5bb566b29533fd6`,
  sha256 `ffbcae62a7b675d616e64cb392ee028786c4cf74f83596590fba13733ef00171`.
- Redistributed **unchanged**: it is only split into parts below 25 MiB for static hosting
  (`scripts/engine/prepare.mjs`) and concatenated again in the browser, where the sha256 is checked.
  `LICENSE.txt` and `NOTICE.txt` are served next to the parts under `/engine/models/…/`.
- ormbg is based on the IS-Net architecture (DIS, https://github.com/xuebinqin/DIS, Apache-2.0).

### ONNX Runtime Web (`onnxruntime-web`)
- © Microsoft Corporation, https://github.com/microsoft/onnxruntime
- Licence: **MIT** (full text: `licenses/onnxruntime-MIT.txt`, also served as `/engine/ort-<version>/LICENSE.txt`)
- Files served unchanged from `node_modules/onnxruntime-web/dist/`: `ort.wasm.min.mjs`, `ort-wasm-simd-threaded.mjs`,
  `ort-wasm-simd-threaded.wasm`.

## QR tools
- qrcode (MIT), https://github.com/soldair/node-qrcode
- jsQR (Apache-2.0), https://github.com/cozmo/jsQR
