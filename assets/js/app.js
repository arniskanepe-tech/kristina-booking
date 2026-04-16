document.addEventListener("DOMContentLoaded", () => {
  const output = document.getElementById("selected-service");
  const bookingStep = document.getElementById("booking-step");
  const buttons = document.querySelectorAll(".service button");

  buttons.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      const services = [
        { name: "Īsā konsultācija", duration: 30 },
        { name: "Standarta konsultācija", duration: 60 },
        { name: "Padziļinātā sesija", duration: 90 }
      ];

      const selected = services[index];

      output.innerHTML =
        "<h2>Tu izvēlējies:</h2>" +
        "<p><strong>" + selected.name + "</strong> (" + selected.duration + " min)</p>";

      bookingStep.innerHTML =
        "<h2>Izvēlies datumu</h2>" +
        "<input type='date' id='booking-date'>" +
        "<div id='time-slots'></div>";

      const dateInput = document.getElementById("booking-date");

      dateInput.addEventListener("change", showTimes);
      dateInput.addEventListener("blur", showTimes);

      function showTimes() {
        const selectedDate = dateInput.value;

        const timeSlots = [
          "09:00",
          "10:00",
          "11:00",
          "14:00",
          "15:00"
        ];

        const slotsHtml = timeSlots.map(time =>
          "<button class='time-btn' data-time='" + time + "'>" + time + "</button>"
        ).join("");

        document.getElementById("time-slots").innerHTML =
          "<h3>Pieejamie laiki:</h3>" +
          slotsHtml +
          "<div id='booking-confirmation'></div>";

        document.querySelectorAll(".time-btn").forEach(timeBtn => {
          timeBtn.addEventListener("click", () => {
            const selectedTime = timeBtn.getAttribute("data-time");

            document.getElementById("booking-confirmation").innerHTML =
              "<h3>Rezervācijas kopsavilkums</h3>" +
              "<p><strong>Pakalpojums:</strong> " + selected.name + "</p>" +
              "<p><strong>Datums:</strong> " + selectedDate + "</p>" +
              "<p><strong>Laiks:</strong> " + selectedTime + "</p>";
          });
        });
      }
    });
  });
});