document.getElementById("openVinted").addEventListener("click", () => chrome.tabs.create({ url: "https://www.vinted.pl/" }));
document.getElementById("signout").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ kind: "SIGN_OUT" });
  window.close();
});
