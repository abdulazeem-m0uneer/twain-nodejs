///////////////////////////////////////////////////////////////////////////////
//
// TWainWorkingGroup.TWAIN
//
//  These are the definitions for TWAIN.  They're essentially the C/C++
//  TWAIN.H file contents translated to JavaScript, on top of Node.js using
//  koffi types, with modifications that recognize the differences between
//  Windows, Linux and Mac OS X.
//
///////////////////////////////////////////////////////////////////////////////
const koffi = require("koffi");
const constants = require("./constants");

/****************************************************************************
 * TWAIN Version                                                            *
 ****************************************************************************/
const TWON_PROTOCOLMINOR = 4;
const TWON_PROTOCOLMAJOR = 2;

/****************************************************************************
 * Platform Dependent Definitions and Typedefs                              *
 ****************************************************************************/
const TWH_64BIT = koffi.sizeof("void *") === 8;
const TWH_32BIT = !TWH_64BIT;

const TWH_CMP_MSC = process.platform === "win32";
const TWH_CMP_OSX = process.platform === "darwin";
const TWH_CMP_LINUX = process.platform === "linux";

const TW_HANDLE = koffi.pointer(koffi.types.void); // HANDLE vs Handle vs void*
const TW_MEMREF = koffi.pointer(koffi.types.void); // LPVOID vs char* vs void*

// UINT_PTR on Windows, unsigned long / unsigned long long elsewhere:
// always as wide as a pointer.
const TW_UINTPTR = koffi.types.uintptr_t;

// Types are anonymous so that loading this module more than once in the same
// process (e.g. under a test runner's module registry) cannot collide with
// koffi's global type names.

/* Set the packing: twain.h uses #pragma pack(2) everywhere except on the
 * Mac, which uses "#pragma options align = power" (natural alignment). */
function struct(members) {
  if (TWH_CMP_OSX) {
    return koffi.struct(members);
  }
  const packed = {};
  for (const [name, type] of Object.entries(members)) {
    packed[name] = [Math.min(koffi.alignof(type), 2), type];
  }
  return koffi.struct(packed);
}

/* TW_CALLINGSTYLE: PASCAL (__stdcall) with the Microsoft compiler, the
 * platform default everywhere else. koffi ignores __stdcall outside x86. */
function proto(result, args) {
  return TWH_CMP_MSC
    ? koffi.proto("__stdcall", result, args)
    : koffi.proto(result, args);
}

/****************************************************************************
 * Type Definitions                                                         *
 ****************************************************************************/

/* String types. These include room for the strings and a NULL char.
 * They read and write as JavaScript strings. */
const TW_STR32 = koffi.array("char", 34);
const TW_STR64 = koffi.array("char", 66);
const TW_STR128 = koffi.array("char", 130);
const TW_STR255 = koffi.array("char", 256);

/* Numeric types. */
const TW_INT8 = koffi.types.int8_t;
const TW_INT16 = koffi.types.int16_t;
const TW_INT32 = koffi.types.int32_t;

const TW_UINT8 = koffi.types.uint8_t;
const TW_UINT16 = koffi.types.uint16_t;
const TW_UINT32 = koffi.types.uint32_t;
const TW_BOOL = koffi.types.uint16_t;

/****************************************************************************
 * Structure Definitions                                                    *
 ****************************************************************************/

/* Fixed point structure type. */
const TW_FIX32 = struct({
  Whole: TW_INT16,
  Frac: TW_UINT16
});

/* Defines a frame rectangle in ICAP_UNITS coordinates. */
const TW_FRAME = struct({
  Left: TW_FIX32,
  Top: TW_FIX32,
  Right: TW_FIX32,
  Bottom: TW_FIX32
});

/* Defines the parameters used for channel-specific transformation. */
const TW_DECODEFUNCTION = struct({
  StartIn: TW_FIX32,
  BreakIn: TW_FIX32,
  EndIn: TW_FIX32,
  StartOut: TW_FIX32,
  BreakOut: TW_FIX32,
  EndOut: TW_FIX32,
  Gamma: TW_FIX32,
  SampleCount: TW_FIX32
});

/* Stores a Fixed point number in two parts, a whole and a fractional part. */
const TW_TRANSFORMSTAGE = struct({
  Decode: koffi.array(TW_DECODEFUNCTION, 3),
  Mix: koffi.array(koffi.array(TW_FIX32, 3), 3)
});

/* Container for array of values */
const TW_ARRAY = struct({
  ItemType: TW_UINT16,
  NumItems: TW_UINT32,
  ItemList: koffi.array(TW_UINT8, 1)
});

/* Information about audio data */
const TW_AUDIOINFO = struct({
  Name: TW_STR255,
  Reserved: TW_UINT32
});

/* Used to register callbacks. */
const TW_CALLBACK = struct({
  CallBackProc: TW_MEMREF,
  RefCon: TWH_CMP_OSX ? TW_MEMREF : TW_UINT32,
  Message: TW_INT16
});

/* Used to register callbacks. */
const TW_CALLBACK2 = struct({
  CallBackProc: TW_MEMREF,
  RefCon: TW_UINTPTR,
  Message: TW_INT16
});

/* Used by application to get/set capability from/in a data source. */
const TW_CAPABILITY = struct({
  Cap: TW_UINT16,
  ConType: TW_UINT16,
  hContainer: TW_HANDLE
});

/* Defines a CIE XYZ space tri-stimulus value. */
const TW_CIEPOINT = struct({
  X: TW_FIX32,
  Y: TW_FIX32,
  Z: TW_FIX32
});

/* Defines the mapping from an RGB color space device into CIE 1931 (XYZ) color space. */
const TW_CIECOLOR = struct({
  ColorSpace: TW_UINT16,
  LowEndian: TW_INT16,
  DeviceDependent: TW_INT16,
  VersionNumber: TW_INT32,
  StageABC: TW_TRANSFORMSTAGE,
  StageLMN: TW_TRANSFORMSTAGE,
  WhitePoint: TW_CIEPOINT,
  BlackPoint: TW_CIEPOINT,
  WhitePaper: TW_CIEPOINT,
  BlackInk: TW_CIEPOINT,
  Samples: koffi.array(TW_FIX32, 1)
});

/* Allows for a data source and application to pass custom data to each other. */
const TW_CUSTOMDSDATA = struct({
  InfoLength: TW_UINT32,
  hData: TW_HANDLE
});

/* Provides information about the Event that was raised by the Source */
const TW_DEVICEEVENT = struct({
  Event: TW_UINT32,
  DeviceName: TW_STR255,
  BatteryMinutes: TW_UINT32,
  BatteryPercentage: TW_INT16,
  PowerSupply: TW_INT32,
  XResolution: TW_FIX32,
  YResolution: TW_FIX32,
  FlashUsed2: TW_UINT32,
  AutomaticCapture: TW_UINT32,
  TimeBeforeFirstCapture: TW_UINT32,
  TimeBetweenCaptures: TW_UINT32
});

/* This structure holds the tri-stimulus color palette information for TW_PALETTE8 structures.*/
const TW_ELEMENT8 = struct({
  Index: TW_UINT8,
  Channel1: TW_UINT8,
  Channel2: TW_UINT8,
  Channel3: TW_UINT8
});

/* Stores a group of individual values describing a capability. */
const TW_ENUMERATION = struct({
  ItemType: TW_UINT16,
  NumItems: TW_UINT32,
  CurrentIndex: TW_UINT32,
  DefaultIndex: TW_UINT32,
  ItemList: koffi.array(TW_UINT8, 1)
});

/* Used to pass application events/messages from the application to the Source. */
const TW_EVENT = struct({
  pEvent: TW_MEMREF,
  TWMessage: TW_UINT16
});

/* This structure is used to pass specific information between the data source and the application. */
const TW_INFO = struct({
  InfoID: TW_UINT16,
  ItemType: TW_UINT16,
  NumItems: TW_UINT16,
  Union: koffi.union({
    ReturnCode: TW_UINT16,
    CondCode: TW_UINT16 // Deprecated, do not use
  }),
  Item: TW_UINTPTR
});

const TW_EXTIMAGEINFO = struct({
  NumInfos: TW_UINT32,
  Info: koffi.array(TW_INFO, 1)
});

/* Provides information about the currently selected device */
const TW_FILESYSTEM = struct({
  InputName: TW_STR255,
  OutputName: TW_STR255,
  Context: TW_MEMREF,
  UnionSubDirectories: koffi.union({
    Recursive: koffi.types.int,
    Subdirectories: TW_BOOL
  }),
  UnionFileType: koffi.union({
    FileType: TW_INT32,
    FileSystemType: TW_UINT32
  }),
  Size: TW_UINT32,
  CreateTimeDate: TW_STR32,
  ModifiedTimeDate: TW_STR32,
  FreeSpace: TW_UINT32,
  NewImageSize: TW_INT32,
  NumberOfFiles: TW_UINT32,
  NumberOfSnippets: TW_UINT32,
  DeviceGroupMask: TW_UINT32,
  Reserved: koffi.array(TW_INT8, 508)
});

/* This structure is used by the application to specify a set of mapping values to be applied to grayscale data. */
const TW_GRAYRESPONSE = struct({
  Response: koffi.array(TW_ELEMENT8, 1)
});

/* A general way to describe the version of software that is running. */
const TW_VERSION = struct({
  MajorNum: TW_UINT16,
  MinorNum: TW_UINT16,
  Language: TW_UINT16,
  Country: TW_UINT16,
  Info: TW_STR32
});

/* Provides identification information about a TWAIN entity.*/
const TW_IDENTITY = struct({
  Id: TWH_CMP_OSX ? TW_MEMREF : TW_UINT32,
  Version: TW_VERSION,
  ProtocolMajor: TW_UINT16,
  ProtocolMinor: TW_UINT16,
  SupportedGroups: TW_UINT32,
  Manufacturer: TW_STR32,
  ProductFamily: TW_STR32,
  ProductName: TW_STR32
});

/* Describes the "real" image data, that is, the complete image being transferred between the Source and application. */
const TW_IMAGEINFO = struct({
  XResolution: TW_FIX32,
  YResolution: TW_FIX32,
  ImageWidth: TW_INT32,
  ImageLength: TW_INT32,
  SamplesPerPixel: TW_INT16,
  BitsPerSample: koffi.array(TW_INT16, 8),
  BitsPerPixel: TW_INT16,
  Planar: TW_BOOL,
  PixelType: TW_INT16,
  Compression: TW_UINT16
});

/* Involves information about the original size of the acquired image. */
const TW_IMAGELAYOUT = struct({
  Frame: TW_FRAME,
  DocumentNumber: TW_UINT32,
  PageNumber: TW_UINT32,
  FrameNumber: TW_UINT32
});

/* Provides information for managing memory buffers. */
const TW_MEMORY = struct({
  Flags: TW_UINT32,
  Length: TW_UINT32,
  TheMem: TW_MEMREF
});

/* Describes the form of the acquired data being passed from the Source to the application.*/
const TW_IMAGEMEMXFER = struct({
  Compression: TW_UINT16,
  BytesPerRow: TW_UINT32,
  Columns: TW_UINT32,
  Rows: TW_UINT32,
  XOffset: TW_UINT32,
  YOffset: TW_UINT32,
  BytesWritten: TW_UINT32,
  Memory: TW_MEMORY
});

/* Describes the information necessary to transfer a JPEG-compressed image. */
const TW_JPEGCOMPRESSION = struct({
  ColorSpace: TW_UINT16,
  SubSampling: TW_UINT32,
  NumComponents: TW_UINT16,
  RestartFrequency: TW_UINT16,
  QuantMap: koffi.array(TW_UINT16, 4),
  QuantTable: koffi.array(TW_MEMORY, 4),
  HuffmanMap: koffi.array(TW_UINT16, 4),
  HuffmanDC: koffi.array(TW_MEMORY, 2),
  HuffmanAC: koffi.array(TW_MEMORY, 2)
});

/* Collects scanning metrics after returning to state 4 */
const TW_METRICS = struct({
  SizeOf: TW_UINT32,
  ImageCount: TW_UINT32,
  SheetCount: TW_UINT32
});

/* Stores a single value (item) which describes a capability. */
const TW_ONEVALUE = struct({
  ItemType: TW_UINT16,
  Item: TW_UINT32
});

/* This structure holds the color palette information. */
const TW_PALETTE8 = struct({
  NumColors: TW_UINT16,
  PaletteType: TW_UINT16,
  Colors: koffi.array(TW_ELEMENT8, 256)
});

/* Used to bypass the TWAIN protocol when communicating with a device */
const TW_PASSTHRU = struct({
  pCommand: TW_MEMREF,
  CommandBytes: TW_UINT32,
  Direction: TW_INT32,
  pData: TW_MEMREF,
  DataBytes: TW_UINT32,
  DataBytesXfered: TW_UINT32
});

/* This structure tells the application how many more complete transfers the Source currently has available. */
const TW_PENDINGXFERS = struct({
  Count: TW_UINT16,
  UnionEOJ: koffi.union({
    EOJ: TW_UINT32,
    Reserved: TW_UINT32
  })
});

/* Stores a range of individual values describing a capability. */
const TW_RANGE = struct({
  ItemType: TW_UINT16,
  MinValue: TW_UINT32,
  MaxValue: TW_UINT32,
  StepSize: TW_UINT32,
  DefaultValue: TW_UINT32,
  CurrentValue: TW_UINT32
});

/* This structure is used by the application to specify a set of mapping values to be applied to RGB color data. */
const TW_RGBRESPONSE = struct({
  Response: koffi.array(TW_ELEMENT8, 1)
});

/* Describes the file format and file specification information for a transfer through a disk file. */
const TW_SETUPFILEXFER = struct({
  FileName: TW_STR255,
  Format: TW_UINT16,
  VRefNum: TW_INT16
});

/* Provides the application information about the Source's requirements and preferences regarding allocation of transfer buffer(s). */
const TW_SETUPMEMXFER = struct({
  MinBufSize: TW_UINT32,
  MaxBufSize: TW_UINT32,
  Preferred: TW_UINT32
});

/* Describes the status of a source. */
const TW_STATUS = struct({
  ConditionCode: TW_UINT16,
  Union: koffi.union({
    Data: TW_UINT16,
    Reserved: TW_UINT16
  })
});

/* Translates the contents of Status into a localized UTF8string. */
const TW_STATUSUTF8 = struct({
  Status: TW_STATUS,
  Size: TW_UINT32,
  UTF8string: TW_HANDLE
});

const TW_TWAINDIRECT = struct({
  SizeOf: TW_UINT32,
  CommunicationManager: TW_UINT16,
  Send: TW_HANDLE,
  SendSize: TW_UINT32,
  Receive: TW_HANDLE,
  ReceiveSize: TW_UINT32
});

/* This structure is used to handle the user interface coordination between an application and a Source. */
const TW_USERINTERFACE = struct({
  ShowUI: TW_BOOL,
  ModalUI: TW_BOOL,
  hParent: TW_HANDLE
});

/****************************************************************************
 * Generic Constants                                                        *
 ****************************************************************************/
// see ./constants.js

/****************************************************************************
 * Depreciated Items                                                        *
 ****************************************************************************/
// not implemented

/****************************************************************************
 * Entry Points                                                             *
 ****************************************************************************/

// Identity pointers are in/out: the DSM writes back into the objects passed
// (e.g. pOrigin.Id on MSG_OPENDSM). Pass null for a NULL pointer.
const pTW_IDENTITY = koffi.inout(koffi.pointer(TW_IDENTITY));

/**********************************************************************
 * Function: DSM_Entry, the only entry point into the Data Source Manager.
 ********************************************************************/
const DSMENTRYPROC = proto(TW_UINT16, [
  pTW_IDENTITY, // pOrigin
  pTW_IDENTITY, // pDest
  TW_UINT32, // DG
  TW_UINT16, // DAT
  TW_UINT16, // MSG
  TW_MEMREF // pData
]);

/**********************************************************************
 * Function: DS_Entry, the entry point provided by a Data Source.
 ********************************************************************/
const DSENTRYPROC = proto(TW_UINT16, [
  pTW_IDENTITY, // pOrigin
  TW_UINT32, // DG
  TW_UINT16, // DAT
  TW_UINT16, // MSG
  TW_MEMREF // pData
]);

// Called by the Source, so koffi hands every pointer argument to the
// JavaScript callback as a raw pointer (decode it with koffi.decode).
const TWAINCALLBACKPROC = proto(TW_UINT16, [
  koffi.pointer(TW_IDENTITY), // pOrigin
  koffi.pointer(TW_IDENTITY), // pDest
  TW_UINT32, // DG
  TW_UINT16, // DAT
  TW_UINT16, // MSG
  TW_MEMREF // pData
]);

const DSM_MEMALLOCATE = proto(TW_HANDLE, [
  TW_UINT32 // _size
]);

const DSM_MEMFREE = proto(koffi.types.void, [
  TW_HANDLE // _handle
]);

const DSM_MEMLOCK = proto(TW_MEMREF, [
  TW_HANDLE // _handle
]);

const DSM_MEMUNLOCK = proto(koffi.types.void, [
  TW_HANDLE // _handle
]);

/* DAT_ENTRYPOINT. returns essential entry points. */
const TW_ENTRYPOINT = struct({
  Size: TW_UINT32,
  DSM_Entry: koffi.pointer(DSMENTRYPROC),
  DSM_MemAllocate: koffi.pointer(DSM_MEMALLOCATE),
  DSM_MemFree: koffi.pointer(DSM_MEMFREE),
  DSM_MemLock: koffi.pointer(DSM_MEMLOCK),
  DSM_MemUnlock: koffi.pointer(DSM_MEMUNLOCK)
});

/* DAT_FILTER */
const TW_FILTER_DESCRIPTOR = struct({
  Size: TW_UINT32,
  HueStart: TW_UINT32,
  HueEnd: TW_UINT32,
  SaturationStart: TW_UINT32,
  SaturationEnd: TW_UINT32,
  ValueStart: TW_UINT32,
  ValueEnd: TW_UINT32,
  Replacement: TW_UINT32
});

/* DAT_FILTER */
const TW_FILTER = struct({
  Size: TW_UINT32,
  DescriptorCount: TW_UINT32,
  MaxDescriptorCount: TW_UINT32,
  Condition: TW_UINT32,
  hDescriptors: TW_HANDLE
});

module.exports = {
  // the koffi instance these types belong to; use it to load the DSM and to
  // encode/decode structures, so that types and functions always match
  koffi,

  TWON_PROTOCOLMINOR,
  TWON_PROTOCOLMAJOR,

  TWH_32BIT,
  TWH_64BIT,

  TWH_CMP_MSC,
  TWH_CMP_OSX,
  TWH_CMP_LINUX,

  // types
  TW_HANDLE,
  TW_MEMREF,
  TW_UINTPTR,

  TW_STR32,
  TW_STR64,
  TW_STR128,
  TW_STR255,

  TW_INT8,
  TW_INT16,
  TW_INT32,
  TW_UINT8,
  TW_UINT16,
  TW_UINT32,
  TW_BOOL,

  // structures
  TW_FIX32,
  TW_FRAME,
  TW_DECODEFUNCTION,
  TW_TRANSFORMSTAGE,
  TW_ARRAY,
  TW_AUDIOINFO,
  TW_CALLBACK,
  TW_CALLBACK2,
  TW_CAPABILITY,
  TW_CIEPOINT,
  TW_CIECOLOR,
  TW_CUSTOMDSDATA,
  TW_DEVICEEVENT,
  TW_ELEMENT8,
  TW_ENUMERATION,
  TW_EVENT,
  TW_INFO,
  TW_EXTIMAGEINFO,
  TW_FILESYSTEM,
  TW_GRAYRESPONSE,
  TW_VERSION,
  TW_IDENTITY,
  TW_IMAGEINFO,
  TW_IMAGELAYOUT,
  TW_MEMORY,
  TW_IMAGEMEMXFER,
  TW_JPEGCOMPRESSION,
  TW_METRICS,
  TW_ONEVALUE,
  TW_PALETTE8,
  TW_PASSTHRU,
  TW_PENDINGXFERS,
  TW_RANGE,
  TW_RGBRESPONSE,
  TW_SETUPFILEXFER,
  TW_SETUPMEMXFER,
  TW_STATUS,
  TW_STATUSUTF8,
  TW_TWAINDIRECT,
  TW_USERINTERFACE,
  TW_ENTRYPOINT,
  TW_FILTER_DESCRIPTOR,
  TW_FILTER,

  // entry points
  DSMENTRYPROC,
  DSENTRYPROC,
  TWAINCALLBACKPROC,
  DSM_MEMALLOCATE,
  DSM_MEMFREE,
  DSM_MEMLOCK,
  DSM_MEMUNLOCK,

  // constants
  ...constants
};
