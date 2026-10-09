import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(packageRoot, "server", "index.js");

export default function (pi) {
  pi.registerMcpServer("pi-browser-bridge", {
    command: process.execPath,
    args: [serverPath],
    cwd: packageRoot,
    timeout: 60,
    exposure: "hidden",
    description: "Control selected Chrome profiles and tabs through local extension connections. Choose profiles by ID when multiple are connected; Pi Bridge workspace groups keep browser tasks organized.",
    toolExposure: {
      get_status: "direct",
      list_profiles: "direct",
      get_active_tab: "direct",
      list_tabs: "direct",
      list_workspaces: "direct",
      create_workspace: "direct",
      read_urls: "direct",
      create_tab: "direct",
      navigate: "direct",
      read_page: "direct",
      get_page_info: "direct",
      get_interactives: "direct",
      click: "direct",
      fill_form: "direct",
      type_text: "direct",
      press_key: "direct",
      scroll: "direct",
      wait_for: "direct",
      screenshot: "direct",
      reset_pairing: "direct",
    },
  });
}
