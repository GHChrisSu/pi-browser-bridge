const state = document.getElementById("state");
const detail = document.getElementById("detail");
const dot = document.getElementById("dot");
const profileFeedback = document.getElementById("profile-feedback");

function render(status) {
  const connected = status?.connected === true;
  state.textContent = connected ? "Connected to Pi" : "Waiting for Pi";
  detail.textContent = connected
    ? `Pi Bridge v${status.extension_version || "0.3.0"} · local only`
    : "Start or reload a Pi session. The extension reconnects automatically.";
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
      state.textContent = "Waiting for Pi";
      detail.textContent = "Start or reload a Pi session. The extension reconnects automatically.";
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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "pi-browser-bridge:state") render(message.status);
});

refresh();
loadProfile();
