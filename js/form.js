// The waitlist API (server/app.mjs), served from the same site. While this is empty the
// form shows "Sign up is not connected yet." and sends nothing.
const FORM_ENDPOINT = "/api/waitlist";

(function () {
  "use strict";

  var form = document.getElementById("updates-form");
  if (!form) { return; }

  var nameInput = form.querySelector("#name");
  var emailInput = form.querySelector("#email");
  var button = form.querySelector("#join-btn");
  var message = form.querySelector("#form-message");
  var trap = form.querySelector("input[name='_gotcha']");
  var buttonLabel = button.textContent;

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setError(input, hasError) {
    var note = document.getElementById(input.id + "-error");
    input.setAttribute("aria-invalid", hasError ? "true" : "false");
    if (note) { note.hidden = !hasError; }
  }

  function clearMessage() {
    message.textContent = "";
    message.classList.remove("form-message--error");
    message.setAttribute("role", "status");
  }

  function showMessage(text, isError) {
    message.textContent = text;
    message.classList.toggle("form-message--error", !!isError);
    message.setAttribute("role", isError ? "alert" : "status");
  }

  function validate() {
    var nameOk = nameInput.value.trim().length > 0;
    var emailOk = EMAIL.test(emailInput.value.trim());
    setError(nameInput, !nameOk);
    setError(emailInput, !emailOk);
    if (!nameOk) { nameInput.focus(); }
    else if (!emailOk) { emailInput.focus(); }
    return nameOk && emailOk;
  }

  function showSuccess() {
    var done = document.createElement("div");
    done.className = "form-success";
    done.setAttribute("tabindex", "-1");
    done.innerHTML = "<h3>You're on the list</h3><p>Thanks for joining. We'll get back to you.</p>";
    form.replaceWith(done);
    done.focus();
  }

  [nameInput, emailInput].forEach(function (input) {
    input.addEventListener("input", function () { setError(input, false); });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (button.disabled) { return; }
    clearMessage();

    if (!validate()) { return; }

    // Spam trap: people never see this field, so a filled one means a bot. Drop it quietly.
    if (trap && trap.value) { showSuccess(); return; }

    if (!FORM_ENDPOINT) {
      showMessage("Sign up is not connected yet.", true);
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Sending...";

    fetch(FORM_ENDPOINT, {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        _gotcha: trap ? trap.value : ""
      })
    }).then(function (response) {
      if (response.status === 429) { throw new Error("rate-limited"); }
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      showSuccess();
    }).catch(function (error) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = buttonLabel;
      showMessage(error.message === "rate-limited"
        ? "Too many sign ups from this connection. Please try again later."
        : "Something went wrong and your info was not sent. Please try again.", true);
    });
  });
})();
