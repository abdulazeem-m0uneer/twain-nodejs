const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const twain = require("../lib/twainh");
const native = require("./native");

const { koffi } = twain;
// The test addon exports a fake DSM_Entry: load it like a real DSM library.
const dsm = koffi.load(native.path);
const DSM_Entry = koffi.decode(dsm.symbol("DSM_Entry"), twain.DSMENTRYPROC);

// TW_IDENTITY.Id is a pointer on the Mac, which koffi represents as a BigInt.
const id = value => (twain.TWH_CMP_OSX ? BigInt(value) : value);

function openDSM() {
  const app = { Id: 0, ProductName: "twain-nodejs tests" };
  const rc = DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_PARENT, twain.MSG_OPENDSM, null);
  assert.equal(rc, twain.TWRC_SUCCESS);
  return app;
}

function getFirstSource(app) {
  const buffer = Buffer.alloc(koffi.sizeof(twain.TW_IDENTITY));
  const rc = DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_IDENTITY, twain.MSG_GETFIRST, buffer);
  assert.equal(rc, twain.TWRC_SUCCESS);
  return koffi.decode(buffer, twain.TW_IDENTITY);
}

function getEntryPoints(app) {
  const buffer = Buffer.alloc(koffi.sizeof(twain.TW_ENTRYPOINT));
  koffi.encode(buffer, twain.TW_ENTRYPOINT, { Size: koffi.sizeof(twain.TW_ENTRYPOINT) });
  const rc = DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_ENTRYPOINT, twain.MSG_GET, buffer);
  assert.equal(rc, twain.TWRC_SUCCESS);
  const entry = koffi.decode(buffer, twain.TW_ENTRYPOINT);
  return {
    DSM_Entry: koffi.decode(entry.DSM_Entry, twain.DSMENTRYPROC),
    DSM_MemAllocate: koffi.decode(entry.DSM_MemAllocate, twain.DSM_MEMALLOCATE),
    DSM_MemFree: koffi.decode(entry.DSM_MemFree, twain.DSM_MEMFREE),
    DSM_MemLock: koffi.decode(entry.DSM_MemLock, twain.DSM_MEMLOCK),
    DSM_MemUnlock: koffi.decode(entry.DSM_MemUnlock, twain.DSM_MEMUNLOCK)
  };
}

describe("DSMENTRYPROC", () => {
  test("writes the identity assigned by MSG_OPENDSM back into pOrigin", () => {
    assert.equal(openDSM().Id, id(42));
  });

  test("passes a NULL pOrigin through as NULL", () => {
    const rc = DSM_Entry(null, null, twain.DG_CONTROL, twain.DAT_PARENT, twain.MSG_OPENDSM, null);
    assert.equal(rc, twain.TWRC_FAILURE);
  });

  test("passes pOrigin's fields to the DSM", () => {
    const stranger = { Id: id(1) };
    const rc = DSM_Entry(stranger, null, twain.DG_CONTROL, twain.DAT_IDENTITY, twain.MSG_GETFIRST, Buffer.alloc(koffi.sizeof(twain.TW_IDENTITY)));
    assert.equal(rc, twain.TWRC_FAILURE);
  });

  test("passes a NULL pData through as NULL", () => {
    const rc = DSM_Entry(openDSM(), null, twain.DG_CONTROL, twain.DAT_IDENTITY, twain.MSG_GETFIRST, null);
    assert.equal(rc, twain.TWRC_FAILURE);
  });

  test("fills a pData buffer that decodes as TW_IDENTITY", () => {
    const source = getFirstSource(openDSM());
    assert.equal(source.Id, id(7));
    assert.equal(source.Manufacturer, "Fake Corp");
    assert.equal(source.ProductName, "Fake Scanner");
    assert.equal(source.ProductFamily, "");
    assert.deepEqual([source.Version.MajorNum, source.Version.MinorNum], [2, 4]);
    assert.equal(source.SupportedGroups, twain.DG_CONTROL | twain.DG_IMAGE | twain.DF_DS2);
  });

  test("returns the DSM's return code", () => {
    const rc = DSM_Entry(openDSM(), null, twain.DG_CONTROL, twain.DAT_IDENTITY, twain.MSG_GETNEXT, Buffer.alloc(koffi.sizeof(twain.TW_IDENTITY)));
    assert.equal(rc, twain.TWRC_ENDOFLIST);
  });
});

describe("TW_ENTRYPOINT", () => {
  test("is rejected by the DSM when Size does not match twain.h", () => {
    const buffer = Buffer.alloc(koffi.sizeof(twain.TW_ENTRYPOINT));
    koffi.encode(buffer, twain.TW_ENTRYPOINT, { Size: koffi.sizeof(twain.TW_ENTRYPOINT) - 1 });
    const rc = DSM_Entry(openDSM(), null, twain.DG_CONTROL, twain.DAT_ENTRYPOINT, twain.MSG_GET, buffer);
    assert.equal(rc, twain.TWRC_FAILURE);
  });

  test("exposes callable DSM entry points", () => {
    const app = openDSM();
    const entry = getEntryPoints(app);
    const rc = entry.DSM_Entry(app, null, twain.DG_CONTROL, twain.DAT_PARENT, twain.MSG_CLOSEDSM, null);
    assert.equal(rc, twain.TWRC_SUCCESS);
  });

  test("memory functions allocate, lock and free handles", () => {
    const entry = getEntryPoints(openDSM());
    const handle = entry.DSM_MemAllocate(koffi.sizeof(twain.TW_ONEVALUE));
    assert.notEqual(handle, null);
    try {
      const memory = entry.DSM_MemLock(handle);
      koffi.encode(memory, twain.TW_ONEVALUE, { ItemType: twain.TWTY_UINT32, Item: 0xdeadbeef });
      assert.deepEqual(koffi.decode(memory, twain.TW_ONEVALUE), { ItemType: twain.TWTY_UINT32, Item: 0xdeadbeef });
      entry.DSM_MemUnlock(handle);
    } finally {
      entry.DSM_MemFree(handle);
    }
  });
});

describe("capability negotiation", () => {
  function getCapability(app, dest, cap) {
    const buffer = Buffer.alloc(koffi.sizeof(twain.TW_CAPABILITY));
    koffi.encode(buffer, twain.TW_CAPABILITY, { Cap: cap, ConType: twain.TWON_DONTCARE16, hContainer: null });
    const rc = DSM_Entry(app, dest, twain.DG_CONTROL, twain.DAT_CAPABILITY, twain.MSG_GET, buffer);
    return { rc, capability: koffi.decode(buffer, twain.TW_CAPABILITY) };
  }

  test("reads a TW_ONEVALUE container through the DSM memory functions", () => {
    const app = openDSM();
    const source = getFirstSource(app);
    const entry = getEntryPoints(app);

    const { rc, capability } = getCapability(app, source, twain.ICAP_XRESOLUTION);
    assert.equal(rc, twain.TWRC_SUCCESS);
    assert.equal(capability.ConType, twain.TWON_ONEVALUE);

    try {
      const container = entry.DSM_MemLock(capability.hContainer);
      const value = koffi.decode(container, twain.TW_ONEVALUE);
      const item = koffi.decode(container, koffi.offsetof(twain.TW_ONEVALUE, "Item"), twain.TW_FIX32);
      assert.equal(value.ItemType, twain.TWTY_FIX32);
      assert.deepEqual(item, { Whole: 300, Frac: 0x8000 });
      entry.DSM_MemUnlock(capability.hContainer);
    } finally {
      entry.DSM_MemFree(capability.hContainer);
    }
  });

  test("passes a NULL pDest through as NULL", () => {
    assert.equal(getCapability(openDSM(), null, twain.ICAP_XRESOLUTION).rc, twain.TWRC_FAILURE);
  });

  test("passes pDest's fields to the DSM", () => {
    assert.equal(getCapability(openDSM(), { Id: id(99) }, twain.ICAP_XRESOLUTION).rc, twain.TWRC_FAILURE);
  });

  test("leaves the container empty when the DSM fails", () => {
    const app = openDSM();
    const { rc, capability } = getCapability(app, getFirstSource(app), twain.ICAP_YRESOLUTION);
    assert.equal(rc, twain.TWRC_FAILURE);
    assert.equal(capability.hContainer, null);
  });
});
