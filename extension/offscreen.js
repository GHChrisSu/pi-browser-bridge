chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "pi-browser-bridge:clipboard") return false;
  const run = async () => {
    if (message.action === "read") {
      const value = await navigator.clipboard.readText();
      const text = value.slice(0, 10_000);
      sendResponse({ text, characters: value.length, truncated: value.length > text.length });
      return;
    }
    if (message.action === "write") {
      const text = String(message.text || "").slice(0, 10_000);
      await navigator.clipboard.writeText(text);
      sendResponse({ written: true, characters: text.length });
      return;
    }
    sendResponse({ error: "Unsupported clipboard action" });
  };
  run().catch((error) => sendResponse({ error: String(error?.message || error).slice(0, 500) }));
  return true;
});
