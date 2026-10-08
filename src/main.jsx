import React from "react";
import ReactDOM from "react-dom/client";
import App, { AppErrorBoundary } from "./App.jsx";
import CustomScrollbar from "./components/CustomScrollbar.jsx";
import "./style.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(
    React.Fragment,
    null,
    React.createElement(AppErrorBoundary, null, React.createElement(App)),
    // Custom-Scrollbar global – gilt für jede Seite/Tab der App
    React.createElement(CustomScrollbar)
  )
);
