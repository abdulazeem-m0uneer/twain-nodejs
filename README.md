# twain-nodejs

A Node.js interface for the [TWAIN](https://www.twain.org) (v2.4 / v2.2) Image Acquisition API, built on top of Node.js buffers using the `ref-napi`, `ref-struct-napi`, and `ffi-napi` type interface.

`twain-nodejs` provides C-level type definitions, byte-packed struct layouts, function prototypes (`DSM_Entry`, `DS_Entry`, memory management hooks), and thousands of standard TWAIN constants needed to interface with physical scanners, ADF feeders, and virtual image capture devices from Node.js.

---

## Table of Contents

- [System Requirements & Architecture](#system-requirements--architecture)
- [Installation](#installation)
- [TWAIN Architecture & State Machine](#twain-architecture--state-machine)
- [Quick Start Guide](#quick-start-guide)
  - [1. Load Data Source Manager (DSM)](#1-load-data-source-manager-dsm)
  - [2. Define Application Identity](#2-define-application-identity)
  - [3. Open the Data Source Manager (State 3 -> 4)](#3-open-the-data-source-manager-state-3---4)
  - [4. Enumerate Available Scanners](#4-enumerate-available-scanners)
  - [5. Open a Scanner Data Source (State 4 -> 5)](#5-open-a-scanner-data-source-state-4---5)
  - [6. Negotiate Capabilities (Resolution, Color, Duplex)](#6-negotiate-capabilities-resolution-color-duplex)
  - [7. Acquire Images (State 5 -> 6 -> 7)](#7-acquire-images-state-5---6---7)
  - [8. Graceful Teardown & Disconnect](#8-graceful-teardown--disconnect)
- [API Reference](#api-reference)
  - [Exported Constants](#exported-constants)
  - [Data Types](#data-types)
  - [Structures (Packed)](#structures-packed)
  - [Entry Points & FFI Signatures](#entry-points--ffi-signatures)
- [Cross-Platform Differences](#cross-platform-differences)
- [Troubleshooting & Common Pitfalls](#troubleshooting--common-pitfalls)
- [License](#license)

---

## System Requirements & Architecture

### 1. Process Bitness (Critical)
TWAIN is an in-process native C ABI. The architecture of your Node.js runtime **must match the bitness of your scanner driver**:
- **32-bit Scanner Driver (most common legacy drivers)**: Requires 32-bit Node.js (`ia32`). Running on 64-bit Node.js will fail with `TWCC_NODS` or library load errors.
- **64-bit Scanner Driver (TWAIN 2.x 64-bit)**: Requires 64-bit Node.js (`x64`).

### 2. TWAIN Data Source Manager (DSM)
Ensure the appropriate TWAIN DSM library is present on your system:
- **Windows**: `TWAINDSM.dll` (TWAIN 2.x, located in `C:\Windows\System32` or `C:\Windows\SysWOW64`) or legacy `twain_32.dll` (TWAIN 1.x in `C:\Windows`).
- **macOS**: `/System/Library/Frameworks/TWAIN.framework` or `/Library/Frameworks/TWAIN.framework`.
- **Linux**: `/usr/local/lib/libtwaindsm.so` or `/usr/lib/libtwaindsm.so`.

### 3. Native Build Tools
Because this package and its underlying FFI dependencies compile native bindings, the host system requires:
- **Windows**: Visual Studio C++ Build Tools (`Desktop development with C++`) and Python 3.x.
- **Linux**: `build-essential` (`gcc`, `g++`, `make`) and Python 3.x.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).

---

## Installation

```bash
npm install twain-nodejs
```

If you encounter native compilation errors during installation, verify that your C++ build environment and Python are configured for `node-gyp`:
```bash
# Windows (run in elevated PowerShell if needed):
npm install --global windows-build-tools
# or install Visual Studio Community / Build Tools with C++ workload
```

---

## TWAIN Architecture & State Machine

TWAIN communication follows a strict 7-state lifecycle:

| State | Name | Description | Key Transitions / Actions |
| :--- | :--- | :--- | :--- |
| **1** | Pre-Session | Source Manager library not loaded | Load `TWAINDSM.dll` via FFI |
| **2** | Source Manager Loaded | DSM DLL mapped into process memory | Ready to open DSM |
| **3** | Source Manager Open | Application identified to DSM | `DG_CONTROL / DAT_PARENT / MSG_OPENDSM` |
| **4** | Source Open | Specific scanner Data Source (DS) opened | `DG_CONTROL / DAT_IDENTITY / MSG_OPENDS` |
| **5** | Source Enabled | Scanner UI or capture mode activated | `DG_CONTROL / DAT_USERINTERFACE / MSG_ENABLEDS` |
| **6** | Transfer Ready | Scanner has image data waiting | Received `MSG_XFERREADY` event |
| **7** | Transferring | Image data streaming / buffer transfer | `DG_IMAGE / DAT_IMAGENATIVEXFER / MSG_GET` |

---

## Quick Start Guide

### 1. Load Data Source Manager (DSM)

Use `ffi-napi` to bind the TWAIN entry point from the platform DSM dynamic library:

```javascript
const ffi = require('ffi-napi');
const ref = require('ref-napi');
const twain = require('twain-nodejs');

// Platform-specific DSM library path
let dsmLibPath = 'TWAINDSM.dll';
if (process.platform === 'darwin') {
  dsmLibPath = '/Library/Frameworks/TWAIN.framework/TWAIN';
} else if (process.platform === 'linux') {
  dsmLibPath = 'libtwaindsm.so';
}

const libtwain = ffi.Library(dsmLibPath, {
  DSM_Entry: twain.DSM_Entry
});
```

---

### 2. Define Application Identity

Before opening the DSM, register your application details using `TW_IDENTITY`:

```javascript
function createString(text, length) {
  const buf = Buffer.alloc(length);
  buf.write(text, 0, 'utf8');
  return buf;
}

const appIdentity = new twain.TW_IDENTITY({
  Id: 0,
  Version: {
    MajorNum: 1,
    MinorNum: 0,
    Language: twain.TWLG_ENGLISH_USA,
    Country: twain.TWCY_USA,
    Info: createString('1.0.0', 34)
  },
  ProtocolMajor: twain.TWON_PROTOCOLMAJOR,
  ProtocolMinor: twain.TWON_PROTOCOLMINOR,
  SupportedGroups: twain.DG_IMAGE | twain.DG_CONTROL,
  Manufacturer: createString('MyCompany', 34),
  ProductFamily: createString('ScannerSoftware', 34),
  ProductName: createString('TwainNodeClient', 34)
});
```

---

### 3. Open the Data Source Manager (State 3 -> 4)

Pass your application identity and a window handle (`hwnd` on Windows, or `null` for headless / non-windowed environments):

```javascript
// On Windows, pass parent HWND or ref.NULL_POINTER
const hwnd = ref.NULL_POINTER;

const rc = libtwain.DSM_Entry(
  appIdentity.ref(),
  ref.NULL_POINTER,
  twain.DG_CONTROL,
  twain.DAT_PARENT,
  twain.MSG_OPENDSM,
  hwnd
);

if (rc !== twain.TWRC_SUCCESS) {
  throw new Error(`Failed to open DSM. Return Code: ${rc}`);
}

console.log('DSM successfully opened (State 3 reached).');
```

---

### 4. Enumerate Available Scanners

Retrieve all registered TWAIN Data Sources:

```javascript
const sources = [];
let dsIdentity = new twain.TW_IDENTITY();

let rc = libtwain.DSM_Entry(
  appIdentity.ref(),
  ref.NULL_POINTER,
  twain.DG_CONTROL,
  twain.DAT_IDENTITY,
  twain.MSG_GETFIRST,
  dsIdentity.ref()
);

while (rc === twain.TWRC_SUCCESS) {
  sources.push({
    id: dsIdentity.Id,
    name: dsIdentity.ProductName.buffer.toString('utf8').replace(/\0/g, '').trim(),
    manufacturer: dsIdentity.Manufacturer.buffer.toString('utf8').replace(/\0/g, '').trim(),
    family: dsIdentity.ProductFamily.buffer.toString('utf8').replace(/\0/g, '').trim(),
    identity: dsIdentity
  });

  dsIdentity = new twain.TW_IDENTITY();
  rc = libtwain.DSM_Entry(
    appIdentity.ref(),
    ref.NULL_POINTER,
    twain.DG_CONTROL,
    twain.DAT_IDENTITY,
    twain.MSG_GETNEXT,
    dsIdentity.ref()
  );
}

console.log('Detected Scanners:', sources.map(s => s.name));
```

---

### 5. Open a Scanner Data Source (State 4 -> 5)

Open a specific scanner by passing its identity:

```javascript
const targetSource = sources[0].identity;

const openDsRc = libtwain.DSM_Entry(
  appIdentity.ref(),
  ref.NULL_POINTER,
  twain.DG_CONTROL,
  twain.DAT_IDENTITY,
  twain.MSG_OPENDS,
  targetSource.ref()
);

if (openDsRc !== twain.TWRC_SUCCESS) {
  throw new Error(`Failed to open Data Source. Code: ${openDsRc}`);
}

console.log(`Scanner "${sources[0].name}" opened (State 4 reached).`);
```

---

### 6. Negotiate Capabilities (Resolution, Color, Duplex)

Set scanner capabilities using `TW_CAPABILITY` and `TW_ONEVALUE`:

```javascript
function setCapabilityOneValue(dsIdentity, capId, itemType, value) {
  // Allocate ONEVALUE container
  const oneValue = new twain.TW_ONEVALUE({
    ItemType: itemType,
    Item: value
  });

  const cap = new twain.TW_CAPABILITY({
    Cap: capId,
    ConType: twain.TWON_ONEVALUE,
    hContainer: oneValue.ref()
  });

  return libtwain.DSM_Entry(
    appIdentity.ref(),
    dsIdentity.ref(),
    twain.DG_CONTROL,
    twain.DAT_CAPABILITY,
    twain.MSG_SET,
    cap.ref()
  );
}

// Example: Set Pixel Type to RGB Color (TWPT_RGB = 2)
setCapabilityOneValue(targetSource, twain.ICAP_PIXELTYPE, twain.TWTY_UINT16, twain.TWPT_RGB);

// Example: Set Resolution to 300 DPI (TW_FIX32: Whole = 300, Frac = 0)
// For integer values in TWON_ONEVALUE:
setCapabilityOneValue(targetSource, twain.ICAP_XRESOLUTION, twain.TWTY_FIX32, 300);
```

---

### 7. Acquire Images (State 5 -> 6 -> 7)

Enable the scanner to begin the acquisition loop:

```javascript
const userInterface = new twain.TW_USERINTERFACE({
  ShowUI: 0,     // 0 = headless / no driver UI popup, 1 = show manufacturer UI
  ModalUI: 0,
  hParent: hwnd
});

const enableRc = libtwain.DSM_Entry(
  appIdentity.ref(),
  targetSource.ref(),
  twain.DG_CONTROL,
  twain.DAT_USERINTERFACE,
  twain.MSG_ENABLEDS,
  userInterface.ref()
);

if (enableRc !== twain.TWRC_SUCCESS) {
  throw new Error(`Failed to enable scanner UI. Code: ${enableRc}`);
}

// Transfer image natively (DIB format on Windows)
const hBitmapPtr = ref.alloc(twain.TW_HANDLE);

const xferRc = libtwain.DSM_Entry(
  appIdentity.ref(),
  targetSource.ref(),
  twain.DG_IMAGE,
  twain.DAT_IMAGENATIVEXFER,
  twain.MSG_GET,
  hBitmapPtr
);

if (xferRc === twain.TWRC_XFERDONE) {
  console.log('Image acquired successfully into native memory handle.');
}

// Acknowledge and query pending transfers
const pendingXfers = new twain.TW_PENDINGXFERS();
libtwain.DSM_Entry(
  appIdentity.ref(),
  targetSource.ref(),
  twain.DG_CONTROL,
  twain.DAT_PENDINGXFERS,
  twain.MSG_ENDXFER,
  pendingXfers.ref()
);
```

---

### 8. Graceful Teardown & Disconnect

Always unwind through the TWAIN states in reverse order to release device locks and system drivers:

```javascript
// 1. Disable Data Source (State 5 -> 4)
libtwain.DSM_Entry(
  appIdentity.ref(),
  targetSource.ref(),
  twain.DG_CONTROL,
  twain.DAT_USERINTERFACE,
  twain.MSG_DISABLEDS,
  userInterface.ref()
);

// 2. Close Data Source (State 4 -> 3)
libtwain.DSM_Entry(
  appIdentity.ref(),
  ref.NULL_POINTER,
  twain.DG_CONTROL,
  twain.DAT_IDENTITY,
  twain.MSG_CLOSEDS,
  targetSource.ref()
);

// 3. Close Data Source Manager (State 3 -> 2)
libtwain.DSM_Entry(
  appIdentity.ref(),
  ref.NULL_POINTER,
  twain.DG_CONTROL,
  twain.DAT_PARENT,
  twain.MSG_CLOSEDSM,
  hwnd
);

console.log('TWAIN session closed cleanly.');
```

---

## API Reference

### Exported Constants

`twain-nodejs` exports all standard numeric constants defined in the TWAIN 2.4 specification:

- **Data Groups (`DG_*`)**: `DG_CONTROL`, `DG_IMAGE`, `DG_AUDIO`.
- **Data Argument Types (`DAT_*`)**: `DAT_IDENTITY`, `DAT_PARENT`, `DAT_USERINTERFACE`, `DAT_CAPABILITY`, `DAT_IMAGEINFO`, `DAT_IMAGENATIVEXFER`, `DAT_IMAGEMEMXFER`, `DAT_PENDINGXFERS`, `DAT_STATUS`, `DAT_EVENT`.
- **Messages (`MSG_*`)**: `MSG_GET`, `MSG_SET`, `MSG_RESET`, `MSG_OPENDSM`, `MSG_CLOSEDSM`, `MSG_OPENDS`, `MSG_CLOSEDS`, `MSG_ENABLEDS`, `MSG_DISABLEDS`, `MSG_XFERREADY`, `MSG_ENDXFER`.
- **Return Codes (`TWRC_*`)**: `TWRC_SUCCESS`, `TWRC_FAILURE`, `TWRC_CHECKSTATUS`, `TWRC_CANCEL`, `TWRC_DSEVENT`, `TWRC_NOTDSEVENT`, `TWRC_XFERDONE`, `TWRC_ENDOFLIST`.
- **Condition Codes (`TWCC_*`)**: `TWCC_SUCCESS`, `TWCC_BUMMER`, `TWCC_LOWMEMORY`, `TWCC_NODS`, `TWCC_BADCAP`, `TWCC_BADVALUE`, `TWCC_SEQERROR`.
- **Capabilities (`CAP_*`, `ICAP_*`)**: `CAP_XFERCOUNT`, `ICAP_PIXELTYPE`, `ICAP_UNITS`, `ICAP_XRESOLUTION`, `ICAP_YRESOLUTION`, `ICAP_COMPRESSION`, `CAP_FEEDERENABLED`, `CAP_AUTOFEED`, `CAP_DUPLEXENABLED`.

### Data Types

| Type | Underlying C Type | ref-napi Representation |
| :--- | :--- | :--- |
| `TW_INT8` / `TW_UINT8` | `char` / `unsigned char` | `ref.types.char` / `ref.types.uchar` |
| `TW_INT16` / `TW_UINT16` | `short` / `unsigned short` | `ref.types.short` / `ref.types.ushort` |
| `TW_INT32` / `TW_UINT32` | `long` / `unsigned long` | `ref.types.long` / `ref.types.ulong` |
| `TW_BOOL` | `unsigned short` | `ref.types.ushort` |
| `TW_HANDLE` | `void*` (Win `HANDLE`) | Pointer |
| `TW_MEMREF` | `void*` (Win `LPVOID`) | Pointer |
| `TW_UINTPTR` | Pointer-sized unsigned integer | `ref.types.uint` (32-bit) / `ref.types.uint64` (64-bit) |
| `TW_STR32` / `TW_STR255` | Fixed-size char arrays | `ref.types.array('char', N + 1)` |

### Structures (Packed)

All structures are packed to 2-byte boundaries (`#pragma pack(2)`) on Windows and Linux according to TWAIN specification:

- `TW_IDENTITY`: Identifies applications and data sources.
- `TW_VERSION`: Software/firmware version descriptor.
- `TW_USERINTERFACE`: Controls UI display, parent HWND, and modal loops.
- `TW_CAPABILITY`: Container header for negotiating device parameters.
- `TW_ONEVALUE`: Single-value capability container.
- `TW_ARRAY`: Array capability container.
- `TW_RANGE`: Range capability container (min, max, step, current).
- `TW_ENUMERATION`: Multi-choice enumeration container.
- `TW_IMAGEINFO`: Describes image resolution, dimensions, bit depth, and compression.
- `TW_IMAGELAYOUT`: Document frame bounding boxes.
- `TW_PENDINGXFERS`: Number of unread scanned pages remaining in the ADF.
- `TW_STATUS`: Detailed error condition code for failed operations.
- `TW_ENTRYPOINT`: Function pointers returned by TWAIN 2.x DSM.

### Entry Points & FFI Signatures

- `DSM_Entry`: Primary entry point to the Data Source Manager.
  ```typescript
  DSM_Entry(
    pOrigin: TW_IDENTITY*,
    pDest: TW_IDENTITY* | null,
    DG: number,
    DAT: number,
    MSG: number,
    pData: Pointer
  ): number // TWRC return code
  ```
- `DS_Entry`: Direct Data Source entry point.
- `TWAIN_Callback`: Callback signature for asynchronous scanner events.
- `DSM_MemAllocate`, `DSM_MemFree`, `DSM_MemLock`, `DSM_MemUnlock`: Memory handling entry points.

---

## Cross-Platform Differences

| Feature | Windows | macOS | Linux |
| :--- | :--- | :--- | :--- |
| **Default DSM Library** | `TWAINDSM.dll` or `twain_32.dll` | `/Library/Frameworks/TWAIN.framework` | `libtwaindsm.so` |
| **Structure Alignment** | `#pragma pack(2)` | Natural / PowerPC alignment | `#pragma pack(2)` |
| **Identity ID Field** | `TW_UINT32` | `TW_MEMREF` (Pointer) | `TW_UINT32` |
| **Parent Handle** | Windows `HWND` pointer | `null` or WindowRef | `null` |

---

## Troubleshooting & Common Pitfalls

### 1. `TWCC_NODS` (No Data Source Found)
- Verify the scanner is connected, turned on, and its TWAIN driver is installed.
- Ensure your Node.js process bitness matches the driver bitness. If the driver is 32-bit, running with 64-bit Node.js will never detect the scanner.

### 2. `node-gyp rebuild` Failure During `npm install`
- Ensure Python 3.x is in your PATH.
- On Windows, verify Visual Studio C++ Build Tools (`MSVC`) are installed.
- Modern Node.js versions (v18, v20, v22) require compatible compiler headers.

### 3. Windows Native Event Loop Locking
- In modal UI mode (`ShowUI = 1`), some TWAIN drivers require Windows message loop pumping (`GetMessage` / `DispatchMessage`).
- For non-interactive or background server services, always set `ShowUI: 0` and negotiate capabilities programmatically.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
