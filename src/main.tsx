import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createBackend } from "./backend";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
void createBackend().then((backend) =>
  root.render(
    <StrictMode>
      <App backend={backend} />
    </StrictMode>,
  ),
);
