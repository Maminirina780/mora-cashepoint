// Cash Point Mora pour Windows : la meme application que le site et l'APK,
// ouverte dans sa propre fenetre. Les donnees restent sur l'ordinateur.
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");

// Deux fenetres ouvertes sur la meme base finiraient par s'ecraser
// mutuellement : un second lancement ramene simplement la premiere.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let fenetre = null;

  app.on("second-instance", () => {
    if (!fenetre) return;
    if (fenetre.isMinimized()) fenetre.restore();
    fenetre.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    fenetre = new BrowserWindow({
      width: 1100,
      height: 780,
      minWidth: 380,
      minHeight: 560,
      title: "Cash Point Mora",
      backgroundColor: "#0f2a4a",
      icon: path.join(__dirname, "www", "icon-512.png"),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    fenetre.loadFile(path.join(__dirname, "www", "index.html"));

    // L'application n'ouvre aucun site : un lien externe part dans le
    // navigateur, jamais dans cette fenetre.
    fenetre.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    fenetre.webContents.on("will-navigate", (e, url) => {
      if (!url.startsWith("file://")) e.preventDefault();
    });
  });

  app.on("window-all-closed", () => app.quit());
}
