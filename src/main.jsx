import React from "react";
import ReactDOM from "react-dom/client";
import App, { AppErrorBoundary } from "./App.jsx";
import "./style.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(AppErrorBoundary, null, React.createElement(App))
);
