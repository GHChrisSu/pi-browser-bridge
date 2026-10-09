const state = document.getElementById("state");
const detail = document.getElementById("detail");
const dot = document.getElementById("dot");

function render(status) {
  const connected = status?.connected === true;
  state.textContent = connected ? "Connected to Pi" : "Waiting for Pi";
  detail.textContent = connected
    ? `Pi Bridge v${status.extension_version || "0.1.0"} · local only`
    : "Start or reload a Pi session. The extension reconnects automatically.";
  dot.classList.toggle("connected", connected);
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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "pi-browser-bridge:state") render(message.status);
});

refresh();
