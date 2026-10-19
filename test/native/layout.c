/* Test-only addon: reports how the C compiler lays out twain.h, and exports
 * a fake DSM_Entry to load and call through the JavaScript prototypes. */
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#endif

#ifdef __APPLE__
/* twain.h maps PASCAL to the obsolete Mac `pascal` keyword. */
#define pascal
#endif

#include "../../twain.h"

#define NAPI_VERSION 8
#include <node_api.h>

typedef struct { const char *name; double value; } Constant;
typedef struct { const char *name; size_t size; } TypeSize;
typedef struct { const char *type; const char *member; size_t offset; } MemberOffset;

#include "generated/layout_table.h"

#define COUNT(array) (sizeof(array) / sizeof((array)[0]))

/****************************************************************************
 * Fake Data Source Manager                                                 *
 ****************************************************************************/

#if defined(_WIN32)
/* twain.h already declares DSM_Entry without dllexport, and MSVC rejects a
 * definition that changes its linkage (C2375), so export it via the linker. */
#define FAKE_EXPORT
#if defined(_WIN64)
#pragma comment(linker, "/EXPORT:DSM_Entry")
#else
#pragma comment(linker, "/EXPORT:DSM_Entry=_DSM_Entry@24")
#endif
#else
#define FAKE_EXPORT __attribute__((visibility("default")))
#endif

/* TW_IDENTITY.Id is a TW_MEMREF on the Mac and a TW_UINT32 elsewhere. */
#ifdef __APPLE__
#define TW_ID(value) ((TW_MEMREF)(uintptr_t)(value))
#else
#define TW_ID(value) ((TW_UINT32)(value))
#endif

#define FAKE_APP_ID TW_ID(42)
#define FAKE_DS_ID TW_ID(7)

/* Handles are plain heap pointers here (TW_HANDLE is a Handle on the Mac). */
static TW_HANDLE TW_CALLINGSTYLE FakeMemAllocate(TW_UINT32 size) { return (TW_HANDLE)malloc(size); }
static void TW_CALLINGSTYLE FakeMemFree(TW_HANDLE handle) { free((void *)handle); }
static TW_MEMREF TW_CALLINGSTYLE FakeMemLock(TW_HANDLE handle) { return (TW_MEMREF)handle; }
static void TW_CALLINGSTYLE FakeMemUnlock(TW_HANDLE handle) { (void)handle; }

static TW_UINT16 FakeGetCapability(pTW_IDENTITY pDest, pTW_CAPABILITY cap)
{
  TW_ONEVALUE *value;
  TW_FIX32 resolution = { 300, 0x8000 }; /* 300.5 */

  if (pDest == NULL || pDest->Id != FAKE_DS_ID || cap->Cap != ICAP_XRESOLUTION)
    return TWRC_FAILURE;

  value = (TW_ONEVALUE *)FakeMemAllocate(sizeof(TW_ONEVALUE));
  if (value == NULL)
    return TWRC_FAILURE;
  value->ItemType = TWTY_FIX32;
  memcpy(&value->Item, &resolution, sizeof(resolution));
  cap->ConType = TWON_ONEVALUE;
  cap->hContainer = (TW_HANDLE)value;
  return TWRC_SUCCESS;
}

FAKE_EXPORT TW_UINT16 TW_CALLINGSTYLE DSM_Entry(pTW_IDENTITY pOrigin,
                                               pTW_IDENTITY pDest,
                                               TW_UINT32 DG,
                                               TW_UINT16 DAT,
                                               TW_UINT16 MSG,
                                               TW_MEMREF pData)
{
  if (pOrigin == NULL)
    return TWRC_FAILURE;

  if (DG == DG_CONTROL && DAT == DAT_PARENT && MSG == MSG_OPENDSM) {
    pOrigin->Id = FAKE_APP_ID;
    return TWRC_SUCCESS;
  }

  /* Everything else needs the identity MSG_OPENDSM handed out. */
  if (pOrigin->Id != FAKE_APP_ID)
    return TWRC_FAILURE;

  if (DG == DG_CONTROL && DAT == DAT_PARENT && MSG == MSG_CLOSEDSM)
    return TWRC_SUCCESS;

  /* Every remaining message reads or writes pData. */
  if (pData == NULL)
    return TWRC_FAILURE;

  if (DG == DG_CONTROL && DAT == DAT_IDENTITY && MSG == MSG_GETFIRST) {
    pTW_IDENTITY ds = (pTW_IDENTITY)pData;
    memset(ds, 0, sizeof(*ds));
    ds->Id = FAKE_DS_ID;
    ds->Version.MajorNum = 2;
    ds->Version.MinorNum = 4;
    ds->ProtocolMajor = TWON_PROTOCOLMAJOR;
    ds->ProtocolMinor = TWON_PROTOCOLMINOR;
    ds->SupportedGroups = DG_CONTROL | DG_IMAGE | DF_DS2;
    memcpy(ds->Manufacturer, "Fake Corp", sizeof("Fake Corp"));
    memcpy(ds->ProductName, "Fake Scanner", sizeof("Fake Scanner"));
    return TWRC_SUCCESS;
  }

  if (DG == DG_CONTROL && DAT == DAT_IDENTITY && MSG == MSG_GETNEXT)
    return TWRC_ENDOFLIST;

  if (DG == DG_CONTROL && DAT == DAT_ENTRYPOINT && MSG == MSG_GET) {
    pTW_ENTRYPOINT entry = (pTW_ENTRYPOINT)pData;
    if (entry->Size != sizeof(TW_ENTRYPOINT))
      return TWRC_FAILURE;
    entry->DSM_Entry = DSM_Entry;
    entry->DSM_MemAllocate = FakeMemAllocate;
    entry->DSM_MemFree = FakeMemFree;
    entry->DSM_MemLock = FakeMemLock;
    entry->DSM_MemUnlock = FakeMemUnlock;
    return TWRC_SUCCESS;
  }

  if (DG == DG_CONTROL && DAT == DAT_CAPABILITY && MSG == MSG_GET)
    return FakeGetCapability(pDest, (pTW_CAPABILITY)pData);

  return TWRC_FAILURE;
}

/****************************************************************************
 * Module                                                                   *
 ****************************************************************************/

#define CHECK(call)                     \
  do {                                  \
    if ((call) != napi_ok) return NULL; \
  } while (0)

static napi_value Constants(napi_env env)
{
  napi_value result, value;
  size_t i;
  CHECK(napi_create_object(env, &result));
  for (i = 0; i < COUNT(kConstants); i++) {
    CHECK(napi_create_double(env, kConstants[i].value, &value));
    CHECK(napi_set_named_property(env, result, kConstants[i].name, value));
  }
  return result;
}

static napi_value Sizes(napi_env env)
{
  napi_value result, value;
  size_t i;
  CHECK(napi_create_object(env, &result));
  for (i = 0; i < COUNT(kSizes); i++) {
    CHECK(napi_create_uint32(env, (uint32_t)kSizes[i].size, &value));
    CHECK(napi_set_named_property(env, result, kSizes[i].name, value));
  }
  return result;
}

static napi_value Offsets(napi_env env)
{
  napi_value result, members, value;
  bool exists;
  size_t i;
  CHECK(napi_create_object(env, &result));
  for (i = 0; i < COUNT(kOffsets); i++) {
    CHECK(napi_has_named_property(env, result, kOffsets[i].type, &exists));
    if (exists) {
      CHECK(napi_get_named_property(env, result, kOffsets[i].type, &members));
    } else {
      CHECK(napi_create_object(env, &members));
      CHECK(napi_set_named_property(env, result, kOffsets[i].type, members));
    }
    CHECK(napi_create_uint32(env, (uint32_t)kOffsets[i].offset, &value));
    CHECK(napi_set_named_property(env, members, kOffsets[i].member, value));
  }
  return result;
}

static bool Export(napi_env env, napi_value exports, const char *name, napi_value value)
{
  return value != NULL && napi_set_named_property(env, exports, name, value) == napi_ok;
}

NAPI_MODULE_INIT()
{
  if (!Export(env, exports, "constants", Constants(env)) ||
      !Export(env, exports, "sizes", Sizes(env)) ||
      !Export(env, exports, "offsets", Offsets(env)))
    return NULL;
  return exports;
}
