import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ProjectsProvider } from "./ProjectsContext";
import { RouterProvider } from "./router";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider>
      <ProjectsProvider>
        <App />
      </ProjectsProvider>
    </RouterProvider>
  </React.StrictMode>,
);
