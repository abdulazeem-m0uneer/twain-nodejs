const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const twain = require("../lib/twainh");
const constants = require("../lib/constants");
const native = require("./native");

const { koffi } = twain;

describe("constants", () => {
  test("match the values compiled from twain.h", () => {
    assert.deepEqual({ ...constants }, native.constants);
  });

  test("are exported by the package entry point", () => {
    for (const [name, value] of Object.entries(constants)) {
      assert.equal(twain[name], value, name);
    }
  });

  test("cannot be modified", () => {
    assert.ok(Object.isFrozen(constants));
  });
});

describe("type sizes match twain.h", () => {
  test("every exported type is measured", () => {
    assert.ok(Object.keys(native.sizes).length > 50);
  });

  for (const [name, size] of Object.entries(native.sizes)) {
    test(name, () => {
      assert.equal(koffi.sizeof(twain[name]), size);
    });
  }
});

describe("structure member offsets match twain.h", () => {
  for (const [name, offsets] of Object.entries(native.offsets)) {
    test(name, () => {
      const actual = Object.fromEntries(
        Object.values(twain[name].members).map(m => [m.name, m.offset])
      );
      assert.deepEqual(actual, offsets);
    });
  }
});

describe("module", () => {
  test("can be loaded more than once in a process", () => {
    delete require.cache[require.resolve("../lib/twainh")];
    assert.doesNotThrow(() => require("../lib/twainh"));
  });

  test("strings round-trip through TW_STR fields", () => {
    const identity = {
      // A TW_MEMREF on the Mac, where a NULL pointer decodes as null.
      Id: twain.TWH_CMP_OSX ? null : 0,
      Version: { MajorNum: 1, MinorNum: 2, Language: 0, Country: 0, Info: "1.2" },
      ProtocolMajor: twain.TWON_PROTOCOLMAJOR,
      ProtocolMinor: twain.TWON_PROTOCOLMINOR,
      SupportedGroups: twain.DG_IMAGE | twain.DG_CONTROL | twain.DF_APP2,
      Manufacturer: "Acme",
      ProductFamily: "",
      ProductName: "x".repeat(33)
    };
    const buffer = Buffer.alloc(koffi.sizeof(twain.TW_IDENTITY));
    koffi.encode(buffer, twain.TW_IDENTITY, identity);
    assert.deepEqual(koffi.decode(buffer, twain.TW_IDENTITY), identity);
  });
});
