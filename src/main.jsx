import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

/*
 * Adaptador de armazenamento.
 * Dentro dos artefatos do Claude existe window.storage (persistência gerenciada).
 * Fora dele (GitHub Pages, Vercel, localhost etc.) usamos o localStorage do navegador,
 * mantendo a mesma interface async { get, set, delete }.
 *
 * ATENÇÃO: localStorage é local de cada navegador/aparelho — NÃO sincroniza dados
 * entre usuários diferentes. Para banco compartilhado real, conecte um back-end
 * (Firebase/Supabase). Veja o README.
 */
if (typeof window !== "undefined" && !window.storage) {
  const K = (key, shared) => `${shared ? "shared" : "local"}::${key}`;
  window.storage = {
    async get(key, shared = false) {
      const value = localStorage.getItem(K(key, shared));
      if (value == null) throw new Error("Key not found: " + key);
      return { key, value, shared };
    },
    async set(key, value, shared = false) {
      localStorage.setItem(K(key, shared), value);
      return { key, value, shared };
    },
    async delete(key, shared = false) {
      localStorage.removeItem(K(key, shared));
      return { key, deleted: true, shared };
    },
    async list(prefix = "", shared = false) {
      const p = K(prefix, shared);
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(p)) keys.push(k.slice(K("", shared).length));
      }
      return { keys, prefix, shared };
    },
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
