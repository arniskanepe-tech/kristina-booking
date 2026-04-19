document.addEventListener("DOMContentLoaded", async () => {
  let bookingData = {
    service: null,
    date: null,
    time: null
  };

  const servicesContainer = document.getElementById("services-container");
  const output = document.getElementById("selected-service");
  const bookingStep = document.getElementById("booking-step");
  const clientFormStep = document.getElementById("client-form-step");

  let services = [];

  async function loadServices() {
    const response = await fetch("/services", { cache: "no-store" });
    services = await response.json();
  }

  function renderServices() {
    servicesContainer.innerHTML = services.map((service, index) => `
      <div class="service">
        <h3>${service.name}</h3>
        <p>${service.duration} min</p>
        <button type="button" class="service-btn" data-index="${index}">Izvēlēties</button>
      </div>
    `).join("");
  }

  function attachServiceEvents() {
    const buttons = document.querySelectorAll(".service-btn");

    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        const index = Number(btn.getAttribute("data-index"));
        const selected = services[index];
        const selectedServiceId = selected.id;

        bookingData.service = selected;
        bookingData.date = null;
        bookingData.time = null;

        clientFormStep.innerHTML = "";

        output.innerHTML =
          "<h2>Tu izvēlējies:</h2>" +
          "<p><strong>" + selected.name + "</strong> (" + selected.duration + " min)</p>";

        bookingStep.innerHTML =
          "<h2>Izvēlies datumu</h2>" +
          "<input type='date' id='booking-date'>" +
          "<div id='time-slots'></div>";

        const dateInput = document.getElementById("booking-date");

        dateInput.addEventListener("change", async () => {
          const selectedDate = dateInput.value;
          bookingData.date = selectedDate;
          bookingData.time = null;

          const response = await fetch(`/slots?serviceId=${selectedServiceId}&date=${selectedDate}`);
          const availableSlots = await response.json();

          if (!availableSlots.length) {
            document.getElementById("time-slots").innerHTML =
              "<h3>Pieejamie laiki:</h3>" +
              "<p>Šajā datumā pieejamu laiku nav.</p>";
            return;
          }

          const slotsHtml = availableSlots.map(time =>
            "<button class='time-btn' data-time='" + time + "'>" + time + "</button>"
          ).join("");

          document.getElementById("time-slots").innerHTML =
            "<h3>Pieejamie laiki:</h3>" +
            slotsHtml +
            "<div id='booking-confirmation'></div>";

          document.querySelectorAll(".time-btn").forEach(timeBtn => {
            timeBtn.addEventListener("click", () => {
              const selectedTime = timeBtn.getAttribute("data-time");
              bookingData.time = selectedTime;

              document.getElementById("booking-confirmation").innerHTML =
                "<h3>Rezervācijas kopsavilkums</h3>" +
                "<p><strong>Pakalpojums:</strong> " + bookingData.service.name + "</p>" +
                "<p><strong>Datums:</strong> " + bookingData.date + "</p>" +
                "<p><strong>Laiks:</strong> " + bookingData.time + "</p>" +
                "<button id='confirm-booking' type='button'>Apstiprināt rezervāciju</button>";

              document.getElementById("confirm-booking").addEventListener("click", () => {
                document.getElementById("booking-confirmation").innerHTML =
                  "<h3>Rezervācija sagatavota</h3>" +
                  "<p>Lūdzu ievadi savus datus, lai pabeigtu rezervāciju.</p>" +
                  "<p><strong>Pakalpojums:</strong> " + bookingData.service.name + "</p>" +
                  "<p><strong>Datums:</strong> " + bookingData.date + "</p>" +
                  "<p><strong>Laiks:</strong> " + bookingData.time + "</p>";

                clientFormStep.innerHTML =
                  "<h2>Ievadi savus datus</h2>" +
                  "<input type='text' id='client-name' placeholder='Vārds'><br><br>" +
                  "<input type='email' id='client-email' placeholder='E-pasts'><br><br>" +
                  "<input type='tel' id='client-phone' placeholder='Telefons'><br><br>" +
                  "<button type='button' id='submit-client'>Apstiprināt rezervāciju</button>";

                document.getElementById("submit-client").addEventListener("click", async () => {
                  const clientName = document.getElementById("client-name").value;
                  const clientEmail = document.getElementById("client-email").value;
                  const clientPhone = document.getElementById("client-phone").value;

                  if (!clientName || !clientEmail) {
                    alert("Lūdzu aizpildi vismaz vārdu un e-pastu");
                    return;
                  }

                  const response = await fetch("/booking", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                      service: bookingData.service.name,
                      date: bookingData.date,
                      time: bookingData.time,
                      name: clientName,
                      email: clientEmail,
                      phone: clientPhone
                    })
                  });

                  const result = await response.json();

                  clientFormStep.innerHTML =
                    "<h2>Paldies!</h2>" +
                    "<p>Rezervācija nosūtīta.</p>" +
                    "<p><strong>Statuss:</strong> " + result.status + "</p>";
                });
              });
            });
          });
        });
      });
    });
  }

  await loadServices();
  renderServices();
  attachServiceEvents();
});