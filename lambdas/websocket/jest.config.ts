import type { Config } from "jest";
import path from "path";
import baseConfig from "../../jest.config.base";

const parentFolder = path.basename(path.dirname(__dirname));
const currentFolder = path.basename(__dirname);
const displayName = `${parentFolder}/${currentFolder}`;

export default {
  ...baseConfig,
  displayName: displayName,
} satisfies Config;
