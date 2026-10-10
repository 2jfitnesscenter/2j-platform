import React from "react";
import { createRoot } from "react-dom/client";
import "@2j/design-tokens/tokens.css";
import "./styles.css";
import { StaffApp } from "./staff-app.js";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StaffApp />
  </React.StrictMode>,
);
if (import.meta.env.PROD && "serviceWorker" in navigator)
  void navigator.serviceWorker.register("/service-worker.js");
