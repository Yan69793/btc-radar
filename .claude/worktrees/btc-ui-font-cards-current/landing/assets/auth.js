// BTC Radar · landing · auth minima (porta exata do gate anterior).
// Unico JS externo: so login/cadastro. Nenhuma animacao roda aqui, e tudo
// em CSS/SVG. Nao usamos inline script por causa da CSP restritiva da raiz.
(function () {
  'use strict';
  var API = "https://btc-radar.prospects-intel.workers.dev";
  var TOKEN_KEY = "btc-radar-token"; // mesma chave de frontend/src/lib/session.ts
  var mode = "login";

  // Sessao valida guardada? Vai direto ao painel.
  try {
    if (localStorage.getItem(TOKEN_KEY)) { window.location.replace("/painel"); }
  } catch (e) {}

  var form = document.getElementById("gate-form");
  var tabLogin = document.getElementById("tab-login");
  var tabRegister = document.getElementById("tab-register");
  var fieldName = document.getElementById("field-name");
  var subtitle = document.getElementById("subtitle");
  var nameInput = document.getElementById("name");
  var emailInput = document.getElementById("email");
  var pw = document.getElementById("password");
  var btn = document.getElementById("submit");
  var err = document.getElementById("error");

  if (!form || !tabLogin || !tabRegister || !btn) { return; }

  function setMode(next) {
    mode = next;
    var isLogin = mode === "login";
    tabLogin.classList.toggle("active", isLogin);
    tabRegister.classList.toggle("active", !isLogin);
    fieldName.classList.toggle("hidden", isLogin);
    subtitle.textContent = isLogin
      ? "Entre com seu email e senha para acessar o painel."
      : "Crie sua conta para acessar o painel.";
    btn.textContent = isLogin ? "Entrar no painel" : "Criar conta e entrar";
    pw.setAttribute("autocomplete", isLogin ? "current-password" : "new-password");
    pw.setAttribute("placeholder", isLogin ? "••••••••" : "Minimo 8 caracteres");
    err.textContent = "";
  }
  tabLogin.addEventListener("click", function () { setMode("login"); });
  tabRegister.addEventListener("click", function () { setMode("register"); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = emailInput.value.trim();
    var password = pw.value;
    if (!email || !password) return;
    if (mode === "register" && nameInput.value.trim().length < 2) {
      err.textContent = "Informe seu nome completo.";
      return;
    }
    var idleLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Verificando...";
    err.textContent = "";

    var payload = mode === "register"
      ? { name: nameInput.value.trim(), email: email, password: password }
      : { email: email, password: password };

    fetch(API + "/api/auth/" + mode, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (json) { return { ok: res.ok, json: json }; });
    }).then(function (r) {
      if (r.ok && r.json && r.json.success && r.json.data && r.json.data.token) {
        try { localStorage.setItem(TOKEN_KEY, r.json.data.token); } catch (e) {}
        window.location.replace("/painel");
      } else {
        btn.disabled = false;
        btn.textContent = idleLabel;
        err.textContent = (r.json && r.json.error) || "Erro ao verificar. Tente novamente.";
        if (mode === "login") { pw.value = ""; pw.focus(); }
      }
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = idleLabel;
      err.textContent = "Falha de conexao. Tente novamente.";
    });
  });
})();
