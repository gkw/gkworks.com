(function () {
  const params = new URLSearchParams(window.location.search);
  const success = document.getElementById("form-success");
  const error = document.getElementById("form-error");
  const form = document.querySelector(".contact-form");

  if (params.get("submitted") === "1" && success) {
    success.hidden = false;
  }

  if (params.get("error") === "1" && error) {
    error.hidden = false;
  }

  if (!form) {
    return;
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (success) {
      success.hidden = true;
    }
    if (error) {
      error.hidden = true;
    }

    const response = await fetch("/contact", {
      method: "POST",
      headers: { "accept": "application/json" },
      body: new FormData(form),
    }).catch(function () {
      return null;
    });

    if (response && response.ok) {
      form.reset();
      if (success) {
        success.hidden = false;
      }
      return;
    }

    if (error) {
      error.hidden = false;
    }
  });
})();
