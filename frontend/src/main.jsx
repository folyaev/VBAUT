import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return React.createElement("pre", {
        style: { color: "red", background: "#111", padding: 24, fontSize: 16, whiteSpace: "pre-wrap" }
      }, "APP CRASH:\n" + String(this.state.error) + "\n\n" + (this.state.error?.stack || ""));
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  React.createElement(ErrorBoundary, null, React.createElement(App))
);