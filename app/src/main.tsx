import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/rubik";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "./index.css";
import "./components/components.css";
import "./screens/screens.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
