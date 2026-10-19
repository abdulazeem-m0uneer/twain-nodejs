# twain-nodejs

A Node.js interface for the [TWAIN](https://www.twain.org) (v2.4) Image Acquisition API, built on [koffi](https://koffi.dev).

`twain-nodejs` provides the C-level type definitions, packed struct layouts, function prototypes (`DSM_Entry`, `DS_Entry`, callbacks, memory management hooks) and the standard TWAIN constants you need to drive scanners, ADF feeders and other image capture devices from Node.js.

Every struct size, field offset and constant is checked in CI against `twain.h` compiled by the platform's own C compiler, on Windows, macOS and Linux.

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Upgrading from 1.x](#upgrading-from-1x)
- [TWAIN Architecture & State Machine](#twain-architecture--state-machine)
- [Quick Start Guide](#quick-start-guide)
  - [1. Load the Data Source Manager (DSM)](#1-load-the-data-source-manager-dsm)
  - [2. Define the Application Identity](#2-define-the-application-identity)
  - [3. Open the Data Source Manager (State 2 -> 3)](#3-open-the-data-source-manager-state-2---3)
  - [4. Get the DSM Memory Functions](#4-get-the-dsm-memory-functions)
  - [5. Enumerate Available Scanners](#5-enumerate-available-scanners)
  - [6. Open a Scanner Data Source (State 3 -> 4)](#6-open-a-scanner-data-source-state-3---4)
  - [7. Negotiate Capabilities](#7-negotiate-capabilities)
  - [8. Acquire Images (State 4 -> 5 -> 6 -> 7)](#8-acquire-images-state-4---5---6---7)
  - [9. Graceful Teardown](#9-graceful-teardown)
- [API Reference](#api-reference)
- [Cross-Platform Differences](#cross-platform-differences)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

---

## Requirements

- **Node.js 22 or newer.** No compiler is needed: koffi ships prebuilt binaries for Windows, macOS, Linux and the BSDs.
- **A TWAIN Data Source Manager (DSM)**:
  - **Windows**: `TWAINDSM.dll` (TWAIN 2.x; `C:\Windows\System32` for 64-bit, `C:\Windows\SysWOW64` for 32-bit).
  - **macOS**: `/Library/Frameworks/TWAINDSM.framework` (TWAIN 2.x DSM).
  - **Linux**: `libtwaindsm.so` from the [TWAIN DSM](https://github.com/twain/twain-dsm) project.
- **Matching bitness.** TWAIN drivers load into your process, so Node.js must have the same bitness as the scanner driver. A 64-bit Node.js never sees a 32-bit driver (you get `TWCC_NODS` or no sources at all). Official 32-bit Windows builds of Node.js stopped after Node.js 22, so 32-bit-only drivers need a 32-bit Node.js 22.

---

## Installation

```bash
npm install twain-nodejs
```

npm 11 may warn that koffi's install script is not approved. You can ignore this: koffi loads its prebuilt binary from a platform package without running the script.

---

## Upgrading from 1.x

Version 2 replaces the unmaintained `ffi-napi` / `ref-napi` stack, which no longer installs on current Node.js, with koffi.

| 1.x | 2.x |
| :--- | :--- |
| `new twain.TW_IDENTITY({...})`, `.ref()` | Plain JavaScript objects; `koffi.encode` / `koffi.decode` for `pData` buffers |
| `ffi.Library(path, { DSM_Entry: twain.DSM_Entry })` | `koffi.decode(koffi.load(path).symbol('DSM_Entry'), twain.DSMENTRYPROC)` |
| `ref.NULL_POINTER` | `null` |
| `TW_STR*` fields as char-array buffers | JavaScript strings |
| `DSM_Entry`, `DS_Entry`, `TWAIN_Callback`, `DSM_MemAllocate`, ... signature arrays | Removed: use the `DSMENTRYPROC`, `DSENTRYPROC`, `TWAINCALLBACKPROC`, `DSM_MEMALLOCATE`, ... prototypes |
| `TW_PACKED` | Removed: packing is applied for you |
| Native build (`node-gyp`) on install | No native build |

2.0 also fixes the struct layouts. In 1.x, `ref-struct` ignored the `pack: 2` option, so on Windows and Linux most structs had the wrong size and field offsets (e.g. `TW_ONEVALUE` was 8 bytes instead of 6).

---

## TWAIN Architecture & State Machine

TWAIN communication follows a strict 7-state lifecycle:

| State | Name | Description | Key Transitions / Actions |
| :--- | :--- | :--- | :--- |
| **1** | Pre-Session | Source Manager library not loaded | Load the DSM library |
| **2** | Source Manager Loaded | DSM mapped into process memory | Ready to open the DSM |
| **3** | Source Manager Open | Application identified to the DSM | `DG_CONTROL / DAT_PARENT / MSG_OPENDSM` |
| **4** | Source Open | A scanner Data Source (DS) is open | `DG_CONTROL / DAT_IDENTITY / MSG_OPENDS` |
| **5** | Source Enabled | Scanner UI or capture mode active | `DG_CONTROL / DAT_USERINTERFACE / MSG_ENABLEDS` |
| **6** | Transfer Ready | Scanner has image data waiting | Received `MSG_XFERREADY` |
| **7** | Transferring | Image data being transferred | `DG_IMAGE / DAT_IMAGENATIVEXFER / MSG_GET` |

---

## Quick Start Guide

How values are passed to `DSM_Entry`:

- `pOrigin` and `pDest` take `TW_IDENTITY` objects (or `null`). The DSM's changes are written back into the object you pass.
- `pData` is a `void *`: pass a `Buffer` holding the encoded structure (or `null`), then decode the result from the same buffer.

Use the `koffi` instance exported by this package, so that types and functions always come from the same koffi copy.

### 1. Load the Data Source Manager (DSM)

```javascript
const twain = require('twain-nodejs');
const { koffi } = twain;

const DSM_LIBRARY = {
  win32: 'TWAINDSM.dll',
  darwin: '/Library/Frameworks/TWAINDSM.framework/TWAINDSM',
  linux: 'libtwaindsm.so'
}[process.platform];

const dsm = koffi.load(DSM_LIBRARY);
const DSM_Entry = koffi.decode(dsm.symbol('DSM_Entry'), twain.DSMENTRYPROC);

// Allocates a buffer holding `value` encoded as `type`, for pData arguments.
function encode(type, value) {
  const buffer = Buffer.alloc(koffi.sizeof(type));
  koffi.encode(buffer, type, value);
  return buffer;
}
```

---

### 2. Define the Application Identity

```javascript
const app = {
  Id: 0, // assigned by the DSM on MSG_OPENDSM
  Version: {
    MajorNum: 1,
    MinorNum: 0,
    Language: twain.TWLG_ENGLISH_USA,
    Country: twain.TWCY_USA,
    Info: '1.0.0'
  },
  ProtocolMajor: twain.TWON_PROTOCOLMAJOR,
  ProtocolMinor: twain.TWON_PROTOCOLMINOR,
  SupportedGroups: twain.DG_IMAGE | twain.DG_CONTROL | twain.DF_APP2,
  Manufacturer: 'MyCompany',
  ProductFamily: 'ScannerSoftware',
  ProductName: 'TwainNodeClient'
};
```

---

### 3. Open the Data Source Manager (State 2 -> 3)

On Windows, `pData` points to the parent window handle (`HWND`). Elsewhere, pass `null`.

```javascript
// Windows: const parent = encode(twain.TW_HANDLE, hwnd);
const parent = null;

const rc = DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_PARENT, twain.MSG_OPENDSM, parent);
if (rc !== twain.TWRC_SUCCESS) {
  throw new Error(`Failed to open the DSM (return code ${rc})`);
}
// app.Id now holds the identifier the DSM assigned.
```

---

### 4. Get the DSM Memory Functions

TWAIN 2.x applications allocate capability containers and receive image handles through the DSM's memory functions.

```javascript
const entryPoint = encode(twain.TW_ENTRYPOINT, { Size: koffi.sizeof(twain.TW_ENTRYPOINT) });
DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_ENTRYPOINT, twain.MSG_GET, entryPoint);

const entry = koffi.decode(entryPoint, twain.TW_ENTRYPOINT);
const mem = {
  allocate: koffi.decode(entry.DSM_MemAllocate, twain.DSM_MEMALLOCATE),
  free: koffi.decode(entry.DSM_MemFree, twain.DSM_MEMFREE),
  lock: koffi.decode(entry.DSM_MemLock, twain.DSM_MEMLOCK),
  unlock: koffi.decode(entry.DSM_MemUnlock, twain.DSM_MEMUNLOCK)
};
```

---

### 5. Enumerate Available Scanners

```javascript
const sources = [];
const identity = Buffer.alloc(koffi.sizeof(twain.TW_IDENTITY));

let rc = DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_IDENTITY, twain.MSG_GETFIRST, identity);
while (rc === twain.TWRC_SUCCESS) {
  sources.push(koffi.decode(identity, twain.TW_IDENTITY));
  rc = DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_IDENTITY, twain.MSG_GETNEXT, identity);
}
// rc is now TWRC_ENDOFLIST

console.log('Detected scanners:', sources.map(s => s.ProductName));
```

---

### 6. Open a Scanner Data Source (State 3 -> 4)

```javascript
const sourceIdentity = encode(twain.TW_IDENTITY, sources[0]);

const rc = DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_IDENTITY, twain.MSG_OPENDS, sourceIdentity);
if (rc !== twain.TWRC_SUCCESS) {
  throw new Error(`Failed to open the data source (return code ${rc})`);
}

// The DSM fills in the source's Id: use this object as pDest from now on.
const source = koffi.decode(sourceIdentity, twain.TW_IDENTITY);
```

---

### 7. Negotiate Capabilities

Capability containers must be allocated with the DSM's memory functions:

```javascript
const ITEM_OFFSET = koffi.offsetof(twain.TW_ONEVALUE, 'Item');

function setOneValue(cap, itemType, itemTypeDef, item) {
  const handle = mem.allocate(koffi.sizeof(twain.TW_ONEVALUE));
  try {
    const container = mem.lock(handle);
    koffi.encode(container, twain.TW_ONEVALUE, { ItemType: itemType, Item: 0 });
    koffi.encode(container, ITEM_OFFSET, itemTypeDef, item);
    mem.unlock(handle);

    const capability = encode(twain.TW_CAPABILITY, {
      Cap: cap,
      ConType: twain.TWON_ONEVALUE,
      hContainer: handle
    });
    return DSM_Entry(app, source, twain.DG_CONTROL, twain.DAT_CAPABILITY, twain.MSG_SET, capability);
  } finally {
    mem.free(handle);
  }
}

// Colour scanning
setOneValue(twain.ICAP_PIXELTYPE, twain.TWTY_UINT16, twain.TW_UINT16, twain.TWPT_RGB);

// 300 DPI: TW_FIX32 values are { Whole, Frac }, where Frac is in 1/65536ths
setOneValue(twain.ICAP_XRESOLUTION, twain.TWTY_FIX32, twain.TW_FIX32, { Whole: 300, Frac: 0 });
setOneValue(twain.ICAP_YRESOLUTION, twain.TWTY_FIX32, twain.TW_FIX32, { Whole: 300, Frac: 0 });
```

To read a capability, send `MSG_GET` with `hContainer: null`, decode the `TW_CAPABILITY` from the buffer, `mem.lock` its `hContainer`, decode the container type named by `ConType`, then `mem.unlock` and `mem.free` it.

---

### 8. Acquire Images (State 4 -> 5 -> 6 -> 7)

Register a callback so the source can tell you when an image is ready, then enable it:

```javascript
let xferReady = false;
const callback = koffi.register((pOrigin, pDest, dg, dat, msg, pData) => {
  if (msg === twain.MSG_XFERREADY) xferReady = true;
  return twain.TWRC_SUCCESS;
}, koffi.pointer(twain.TWAINCALLBACKPROC));

DSM_Entry(app, source, twain.DG_CONTROL, twain.DAT_CALLBACK2, twain.MSG_REGISTER_CALLBACK,
  encode(twain.TW_CALLBACK2, { CallBackProc: callback, RefCon: 0, Message: 0 }));

const userInterface = encode(twain.TW_USERINTERFACE, {
  ShowUI: 0, // 0 = no driver UI, 1 = show the manufacturer's UI
  ModalUI: 0,
  hParent: null
});
DSM_Entry(app, source, twain.DG_CONTROL, twain.DAT_USERINTERFACE, twain.MSG_ENABLEDS, userInterface);
```

Once `MSG_XFERREADY` has arrived, transfer each pending image:

```javascript
const imageHandle = Buffer.alloc(koffi.sizeof(twain.TW_HANDLE));
const pending = Buffer.alloc(koffi.sizeof(twain.TW_PENDINGXFERS));

do {
  const rc = DSM_Entry(app, source, twain.DG_IMAGE, twain.DAT_IMAGENATIVEXFER, twain.MSG_GET, imageHandle);
  if (rc === twain.TWRC_XFERDONE) {
    const handle = koffi.decode(imageHandle, twain.TW_HANDLE);
    const image = mem.lock(handle); // a DIB on Windows, a TIFF on Linux, a PICT on macOS
    // ... copy the image out, e.g. with koffi.view(image, length)
    mem.unlock(handle);
    mem.free(handle);
  }
  DSM_Entry(app, source, twain.DG_CONTROL, twain.DAT_PENDINGXFERS, twain.MSG_ENDXFER, pending);
} while (koffi.decode(pending, twain.TW_PENDINGXFERS).Count !== 0);
```

---

### 9. Graceful Teardown

Always unwind through the TWAIN states in reverse order to release the device:

```javascript
// State 5 -> 4
DSM_Entry(app, source, twain.DG_CONTROL, twain.DAT_USERINTERFACE, twain.MSG_DISABLEDS, userInterface);
// State 4 -> 3
DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_IDENTITY, twain.MSG_CLOSEDS, encode(twain.TW_IDENTITY, source));
// State 3 -> 2
DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_PARENT, twain.MSG_CLOSEDSM, parent);

koffi.unregister(callback);
dsm.unload();
```

---

## API Reference

### Constants

Every TWAIN 2.4 constant from `twain.h` (except the deprecated ones) is exported as a number: data groups (`DG_*`), data argument types (`DAT_*`), messages (`MSG_*`), return codes (`TWRC_*`), condition codes (`TWCC_*`), capabilities (`CAP_*`, `ICAP_*`, `ACAP_*`) and their values (`TWPT_*`, `TWUN_*`, `TWSX_*`, ...), languages (`TWLG_*`) and countries (`TWCY_*`).

### Data Types

| Type | C type | koffi type |
| :--- | :--- | :--- |
| `TW_INT8` / `TW_UINT8` | `char` / `unsigned char` | `int8_t` / `uint8_t` |
| `TW_INT16` / `TW_UINT16` | `short` / `unsigned short` | `int16_t` / `uint16_t` |
| `TW_INT32` / `TW_UINT32` | `int` / `unsigned int` | `int32_t` / `uint32_t` |
| `TW_BOOL` | `unsigned short` | `uint16_t` |
| `TW_HANDLE` / `TW_MEMREF` | `void *` (`HANDLE` / `LPVOID` on Windows) | `void *` (a `BigInt` or `null` in JavaScript) |
| `TW_UINTPTR` | Pointer-sized unsigned integer | `uintptr_t` |
| `TW_STR32` / `TW_STR64` / `TW_STR128` / `TW_STR255` | `char[34]` / `[66]` / `[130]` / `[256]` | `char` arrays, read and written as strings |

### Structures

All the TWAIN 2.4 structures are exported under their C names (`TW_IDENTITY`, `TW_CAPABILITY`, `TW_ONEVALUE`, `TW_ARRAY`, `TW_RANGE`, `TW_ENUMERATION`, `TW_IMAGEINFO`, `TW_IMAGELAYOUT`, `TW_PENDINGXFERS`, `TW_STATUS`, `TW_ENTRYPOINT`, ...), with the same field names.

C anonymous unions become named fields holding an object: `TW_INFO.Union`, `TW_STATUS.Union`, `TW_PENDINGXFERS.UnionEOJ`, `TW_FILESYSTEM.UnionSubDirectories` and `TW_FILESYSTEM.UnionFileType`.

### Entry Points

Function prototypes, used with `koffi.decode` (to call a function pointer) and `koffi.register` (to implement a callback):

| Prototype | Signature |
| :--- | :--- |
| `DSMENTRYPROC` | `TW_UINT16 DSM_Entry(pTW_IDENTITY pOrigin, pTW_IDENTITY pDest, TW_UINT32 DG, TW_UINT16 DAT, TW_UINT16 MSG, TW_MEMREF pData)` |
| `DSENTRYPROC` | `TW_UINT16 DS_Entry(pTW_IDENTITY pOrigin, TW_UINT32 DG, TW_UINT16 DAT, TW_UINT16 MSG, TW_MEMREF pData)` |
| `TWAINCALLBACKPROC` | `TW_UINT16 TWAIN_Callback(pTW_IDENTITY pOrigin, pTW_IDENTITY pDest, TW_UINT32 DG, TW_UINT16 DAT, TW_UINT16 MSG, TW_MEMREF pData)` |
| `DSM_MEMALLOCATE` | `TW_HANDLE DSM_MemAllocate(TW_UINT32 size)` |
| `DSM_MEMFREE` | `void DSM_MemFree(TW_HANDLE handle)` |
| `DSM_MEMLOCK` | `TW_MEMREF DSM_MemLock(TW_HANDLE handle)` |
| `DSM_MEMUNLOCK` | `void DSM_MemUnlock(TW_HANDLE handle)` |

In `DSMENTRYPROC` and `DSENTRYPROC`, `pOrigin` and `pDest` take `TW_IDENTITY` objects and receive the DSM's changes. A `TWAINCALLBACKPROC` callback receives every pointer as a raw pointer (`BigInt` or `null`): read it with `koffi.decode(pointer, twain.TW_IDENTITY)`. On Windows the prototypes use `__stdcall` (TWAIN's `PASCAL`), as `twain.h` requires.

### Platform Flags

`TWH_32BIT`, `TWH_64BIT`, `TWH_CMP_MSC` (Windows), `TWH_CMP_OSX` (macOS) and `TWH_CMP_LINUX`.

---

## Cross-Platform Differences

| Feature | Windows | macOS | Linux |
| :--- | :--- | :--- | :--- |
| **DSM library** | `TWAINDSM.dll` | `TWAINDSM.framework` | `libtwaindsm.so` |
| **Structure alignment** | `#pragma pack(2)` | Natural (`align = power`) | `#pragma pack(2)` |
| **`TW_IDENTITY.Id`, `TW_CALLBACK.RefCon`** | `TW_UINT32` | `TW_MEMREF` (pointer) | `TW_UINT32` |
| **Calling convention** | `__stdcall` | default | default |
| **Parent window (`MSG_OPENDSM`)** | Pointer to an `HWND` | `null` | `null` |

---

## Troubleshooting

### `TWCC_NODS` / no scanners listed
- Check that the scanner is connected, switched on, and its TWAIN driver is installed.
- Check that Node.js and the driver have the same bitness (`process.arch`).

### `koffi.load` fails
- The DSM is not installed, or not on the library search path: pass its absolute path.
- The DSM's bitness does not match Node.js.

### The process aborts while encoding a structure
- koffi 3.3 aborts the process, instead of throwing, when a structure field gets a value of the wrong type, e.g. `null` or a string for a number field. This also applies to the identity objects passed to `DSM_Entry`. Give integer fields numbers, and use `null` only for pointer fields (`TW_HANDLE`, `TW_MEMREF`).

### The source never sends `MSG_XFERREADY` (Windows)
- Some Windows drivers only deliver events through the Windows message loop (`DAT_EVENT` / `MSG_PROCESSEVENT`), especially with `ShowUI: 1`. For background services, use `ShowUI: 0` and negotiate capabilities programmatically.

---

## Development

```bash
npm install
npm run lint
npm test
```

`npm test` first builds a small test-only addon (`test/native`) against `twain.h`, which needs a C compiler and Python for `node-gyp`. The tests compare every exported constant, type size and structure field offset with what the C compiler produces, and drive the prototypes through a fake `DSM_Entry`.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
