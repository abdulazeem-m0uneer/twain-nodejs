// Built by `npm test` (see the pretest script).
const path = require("path");

const addonPath = path.join(__dirname, "build", "Release", "layout.node");

module.exports = { ...require(addonPath), path: addonPath };
