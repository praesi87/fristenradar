import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { App } from "./ui/App";
import { istAnmeldePopup } from "./lib/auth";

const wurzel = document.getElementById("root")!;

// Im Microsoft-Popup nur warten: Das Hauptfenster liest die Antwort aus der Adresse und schließt das Fenster.
if (istAnmeldePopup()) {
  wurzel.textContent = "Anmeldung wird abgeschlossen …";
} else {
  createRoot(wurzel).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
