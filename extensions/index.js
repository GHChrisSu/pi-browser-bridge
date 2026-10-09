import { basename, dirname, join, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(packageRoot, "server", "index.js");

export default function (pi) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "mcp__pi_browser_bridge__upload_file") return undefined;
    const filePath = typeof event.input.file_path === "string" ? event.input.file_path : "(unknown file)";
    let localFile;
    let fileSize;
    try {
      localFile = await realpath(filePath);
      const info = await stat(localFile);
      if (!info.isFile() || info.size <= 0 || info.size > 50 * 1024 * 1024) throw new Error("File must be a non-empty regular file no larger than 50 MiB");
      fileSize = info.size;
    } catch (error) {
      return { block: true, reason: `Local upload file is unavailable: ${error.message}` };
    }
    event.input.file_path = localFile;
    const targetOrigin = typeof event.input.target_origin === "string" ? event.input.target_origin : "(unknown website)";
    const profileId = typeof event.input.profile_id === "string" ? event.input.profile_id : "(unknown profile)";
    if (!ctx.hasUI) return { block: true, reason: "File uploads are blocked when Pi cannot show an explicit confirmation dialog." };
    const approved = await ctx.ui.confirm(
      "Upload a local file to a website?",
      `File: ${basename(localFile)} (${fileSize.toLocaleString()} bytes)\nPath: ${localFile}\nWebsite: ${targetOrigin}\nChrome profile: ${profileId}\nTab ID: ${String(event.input.tab_id ?? "(unknown tab)")}\n\nThe website will receive this file. Continue?`,
    );
    if (!approved) return { block: true, reason: "The user declined the local file upload." };
    return undefined;
  });

  pi.registerMcpServer("pi-browser-bridge", {
    command: process.execPath,
    args: [serverPath],
    cwd: packageRoot,
    timeout: 180,
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
      get_accessibility_tree: "direct",
      get_visible_dom: "direct",
      get_by_role: "direct",
      click_by_role: "direct",
      fill_by_role: "direct",
      fill_accessibility_node: "direct",
      click_dom_node: "direct",
      click_accessibility_node: "direct",
      list_page_assets: "direct",
      get_interactives: "direct",
      click: "direct",
      fill_form: "direct",
      type_text: "direct",
      press_key: "direct",
      scroll: "direct",
      wait_for: "direct",
      screenshot: "direct",
      download_url: "direct",
      download_media: "direct",
      upload_file: "direct",
      reset_pairing: "direct",
    },
  });
}
