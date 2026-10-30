import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createBackend } from "./backend";
import { createPlatform } from "./platform";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
void Promise.all([createBackend(), createPlatform()]).then(([backend, platform]) =>
  root.render(
    <StrictMode>
      <App backend={backend} platform={platform} />
    </StrictMode>,
  ),
);
