const state = document.getElementById("state");
const detail = document.getElementById("detail");
const dot = document.getElementById("dot");
const profileFeedback = document.getElementById("profile-feedback");

function render(status) {
  const connected = status?.connected === true;
  const stateLabels = {
    connecting: "Connecting to Pi",
    refused: "Pairing refused",
    disconnected: "Pi Bridge unavailable",
  };
  state.textContent = connected ? "Connected to Pi" : stateLabels[status?.state] || "Waiting for Pi";
  detail.textContent = connected
    ? `Pi Bridge v${status.extension_version || "0.9.0"} · local only`
    : status?.note || "Start or reload a Pi session. The extension reconnects automatically.";
  dot.classList.toggle("connected", connected);
  if (status?.profile_name && profileFeedback.dataset.saved !== "true") {
    profileFeedback.textContent = `Pi routes tools using “${status.profile_name}”.`;
  }
}

function loadProfile() {
  chrome.runtime.sendMessage({ type: "pi-browser-bridge:get-profile" }, (profile) => {
    if (chrome.runtime.lastError || profile?.error) return;
    document.getElementById("profile-name").value = profile.name || "";
    document.getElementById("profile-id").textContent = `Profile ID: ${profile.id}`;
  });
}

function saveProfile() {
  const input = document.getElementById("profile-name");
  chrome.runtime.sendMessage({ type: "pi-browser-bridge:set-profile-name", name: input.value }, (profile) => {
    if (chrome.runtime.lastError || profile?.error) {
      profileFeedback.textContent = profile?.error || "Could not save profile name.";
      profileFeedback.classList.add("error");
      profileFeedback.dataset.saved = "false";
      return;
    }
    input.value = profile.profile_name;
    document.getElementById("profile-id").textContent = `Profile ID: ${profile.profile_id}`;
    profileFeedback.textContent = `Saved as “${profile.profile_name}”.`;
    profileFeedback.classList.remove("error");
    profileFeedback.dataset.saved = "true";
  });
}

function refresh() {
  chrome.runtime.sendMessage({ type: "pi-browser-bridge:get-status" }, (response) => {
    if (chrome.runtime.lastError) {
      state.textContent = "Pi Bridge unavailable";
      detail.textContent = "Chrome could not read the Pi Bridge service worker status. Reload the extension from chrome://extensions.";
      dot.classList.remove("connected");
      return;
    }
    render(response);
  });
}

document.getElementById("reconnect").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "pi-browser-bridge:reconnect" }, refresh);
});
document.getElementById("save-profile").addEventListener("click", saveProfile);
document.getElementById("profile-name").addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveProfile();
});

const permissionGroups = [
  { id: "network-observation", button: "permission-network-observation", permissions: ["webRequest"], label: "Network observation" },
  { id: "network-rules", button: "permission-network-rules", permissions: ["declarativeNetRequestWithHostAccess"], label: "Network rules" },
  { id: "page-scripts", button: "permission-page-scripts", permissions: ["userScripts"], label: "Page scripts" },
  { id: "site-data", button: "permission-site-data", permissions: ["cookies"], label: "Cookies and site storage" },
  { id: "http-auth", button: "permission-http-auth", permissions: ["webRequest", "webRequestAuthProvider"], label: "HTTP authentication" },
  { id: "page-capture", button: "permission-page-capture", permissions: ["pageCapture"], label: "Save page archive" },
  { id: "clipboard", button: "permission-clipboard", permissions: ["clipboardRead", "clipboardWrite", "offscreen"], label: "Clipboard read/write" },
];

async function renderPermissions() {
  for (const group of permissionGroups) {
    const button = document.getElementById(group.button);
    try {
      const granted = await chrome.permissions.contains({ permissions: group.permissions });
      button.textContent = granted ? "Disable" : "Enable";
      button.dataset.enabled = granted ? "true" : "false";
      button.setAttribute("aria-pressed", String(granted));
    } catch {
      button.textContent = "Unavailable";
      button.disabled = true;
    }
  }
}

for (const group of permissionGroups) {
  document.getElementById(group.button).addEventListener("click", async () => {
    const button = document.getElementById(group.button);
    const feedback = document.getElementById("permission-feedback");
    button.disabled = true;
    try {
      const granted = button.dataset.enabled === "true";
      let changed;
      if (granted) {
        if (group.id === "network-rules") {
          await new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: "pi-browser-bridge:clear-network-rules" }, (result) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else if (result?.error) reject(new Error(result.error));
            else resolve(result);
          }));
        }
        changed = await chrome.permissions.remove({ permissions: group.permissions });
      } else {
        changed = await chrome.permissions.request({ permissions: group.permissions });
      }
      feedback.textContent = changed
        ? `${group.label} ${granted ? "disabled" : "enabled"}.`
        : `Chrome did not grant ${group.label.toLowerCase()} permission.`;
    } catch (error) {
      feedback.textContent = `Could not change ${group.label.toLowerCase()} permission: ${error.message || error}`;
    } finally {
      button.disabled = false;
      await renderPermissions();
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "pi-browser-bridge:state") render(message.status);
});

refresh();
loadProfile();
renderPermissions();
