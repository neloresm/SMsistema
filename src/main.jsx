import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

/*
 * SM sistema — todos os dados e o login são gerenciados pelo Supabase
 * (banco na nuvem). Nenhum dado do sistema fica salvo neste navegador;
 * apenas o token de sessão do login (para manter o usuário conectado).
 */
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
