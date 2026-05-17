require("dotenv").config();

const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");
const app = express();
app.use(express.json());

let frontendPath = "/var/www/kristina/couch";

// ja servera ceļš neeksistē → izmanto lokālo
if (!fs.existsSync(frontendPath)) {
frontendPath = path.join(__dirname, "..", "kristina-couch");
}

app.use("/kristina", express.static(frontendPath));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const CREDENTIALS_PATH = path.join(__dirname, "credentials", "google.json");
const TOKEN_PATH = path.join(__dirname, "credentials", "token.json");
const BOOKINGS_PATH = path.join(__dirname, "data", "bookings.json");

const SERVICES_PATH = path.join(__dirname, "data", "services.json");

const AVAILABILITY_PATH = path.join(__dirname, "data", "availability.json");

function loadAvailability() {
  const data = fs.readFileSync(AVAILABILITY_PATH, "utf8");
  return JSON.parse(data);
}

function loadServices() {
  const data = fs.readFileSync(SERVICES_PATH, "utf8");
  return JSON.parse(data);
}

function saveServices(services) {
  fs.writeFileSync(SERVICES_PATH, JSON.stringify(services, null, 2), "utf8");
}


async function loadSavedCredentialsIfExist() {
  try {
    const content = await fsp.readFile(TOKEN_PATH, "utf8");
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

async function saveCredentials(client) {
  const content = await fsp.readFile(CREDENTIALS_PATH, "utf8");
  const keys = JSON.parse(content);

  const key = keys.installed || keys.web;

  const payload = {
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token
  };

  await fsp.writeFile(TOKEN_PATH, JSON.stringify(payload, null, 2));
}

async function authorize() {
  let client = await loadSavedCredentialsIfExist();

  if (client) {
    return client;
  }

  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH
  });

  if (client.credentials && client.credentials.refresh_token) {
    await saveCredentials(client);
  }

  return client;
}

function ensureBookingsFile() {
  if (!fs.existsSync(path.dirname(BOOKINGS_PATH))) {
    fs.mkdirSync(path.dirname(BOOKINGS_PATH), { recursive: true });
  }

  if (!fs.existsSync(BOOKINGS_PATH)) {
    fs.writeFileSync(BOOKINGS_PATH, "[]");
  }
}

function loadBookings() {
  ensureBookingsFile();
  const data = fs.readFileSync(BOOKINGS_PATH, "utf8");
  return JSON.parse(data);
}

function saveBookings(bookings) {
  fs.writeFileSync(BOOKINGS_PATH, JSON.stringify(bookings, null, 2));
}

function getServiceByName(serviceName) {
  const services = loadServices();
  return services.find(service => service.name === serviceName);
}

function generateSlots(from, to, duration) {
  const slots = [];

  const [fromHour, fromMinute] = from.split(":").map(Number);
  const [toHour, toMinute] = to.split(":").map(Number);

  const start = new Date();
  start.setHours(fromHour, fromMinute, 0, 0);

  const end = new Date();
  end.setHours(toHour, toMinute, 0, 0);

  let current = new Date(start);

  while (true) {
    const slotEnd = new Date(current.getTime() + duration * 60 * 1000);

    if (slotEnd > end) {
      break;
    }

    const hours = String(current.getHours()).padStart(2, "0");
    const minutes = String(current.getMinutes()).padStart(2, "0");

    slots.push(`${hours}:${minutes}`);

    current = new Date(current.getTime() + duration * 60 * 1000);
  }

  return slots;
}

function getEndDateTime(date, time, serviceName) {
  const startDate = new Date(`${date}T${time}:00`);
  const service = getServiceByName(serviceName);
  const durationMinutes = service ? service.duration : 60;

  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  return endDate;
}

async function getGoogleBusyIntervals(date) {
  const auth = await authorize();
  const calendar = google.calendar({ version: "v3", auth });

  const timeMin = new Date(`${date}T00:00:00`);
  const timeMax = new Date(`${date}T23:59:59`);

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: "Europe/Riga",
      items: [{ id: "primary" }]
    }
  });

  const busy = response.data.calendars.primary.busy || [];

  return busy.map(item => ({
    start: new Date(item.start),
    end: new Date(item.end)
  }));
}

app.get("/kristina", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.get("/kristina/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// services API
app.get("/services", (req, res) => {
  try {
    const services = loadServices();
    res.json(services);
  } catch (err) {
    console.error("Kļūda nolasot services:", err);
    res.status(500).json({ status: "error" });
  }
});

app.get("/kristina/services", (req, res) => {
  try {
    const services = loadServices();
    res.json(services);
  } catch (err) {
    console.error("Kļūda nolasot services:", err);
    res.status(500).json({ status: "error" });
  }
});

app.put(["/services/:id", "/kristina/services/:id"], (req, res) => {
  try {
    const serviceId = Number(req.params.id);
    const { name, duration } = req.body;

    if (!name || !duration) {
      return res.status(400).json({
        status: "error",
        message: "Trūkst name vai duration"
      });
    }

    const services = loadServices();
    const serviceIndex = services.findIndex(s => s.id === serviceId);

    if (serviceIndex === -1) {
      return res.status(404).json({
        status: "error",
        message: "Service nav atrasts"
      });
    }

    services[serviceIndex] = {
      ...services[serviceIndex],
      name,
      duration: Number(duration)
    };

    saveServices(services);

    console.log("Saglabāts service:", services[serviceIndex]);

    res.json({
      status: "ok",
      service: services[serviceIndex]
    });
  } catch (err) {
    console.error("Kļūda saglabājot service:", err);
    res.status(500).json({
      status: "error",
      message: "Neizdevās saglabāt service"
    });
  }
});



app.get(["/availability", "/kristina/availability"], (req, res) => {
  try {
    const availability = loadAvailability();
    const services = loadServices();

    const result = availability.map((a, index) => {
      const service = services.find(s => s.id === a.serviceId);
      return {
        ...a,
        index,
        serviceName: service ? service.name : "Nezināms"
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Kļūda availability:", err);
    res.status(500).json({ status: "error" });
  }
});

app.get(["/slots", "/kristina/slots"], async (req, res) => {
  try {
    const { serviceId, date } = req.query;

    if (!serviceId || !date) {
      return res.status(400).json({ error: "serviceId un date obligāti" });
    }

    const services = loadServices();
    const availability = loadAvailability();
    const bookings = loadBookings();

    const selectedService = services.find(s => s.id === Number(serviceId));

    if (!selectedService) {
      return res.status(404).json({ error: "Service nav atrasts" });
    }

    const day = new Date(date).getDay();

    const rules = availability.filter(a =>
      a.serviceId === Number(serviceId) &&
      a.weekday === day &&
      a.active
    );

    let allSlots = [];

    rules.forEach(rule => {
      const slots = generateSlots(rule.from, rule.to, selectedService.duration);
      allSlots = allSlots.concat(slots);
    });

    function getDateTime(dateString, timeString) {
      return new Date(`${dateString}T${timeString}:00`);
    }

    function getServiceDurationByName(serviceName) {
      const service = services.find(s => s.name === serviceName);
      return service ? service.duration : 60;
    }

    function overlaps(startA, endA, startB, endB) {
      return startA < endB && endA > startB;
    }

const googleBusy = await getGoogleBusyIntervals(date);

  const freeSlots = allSlots.filter(slot => {
  const slotStart = getDateTime(date, slot);
  const slotEnd = new Date(slotStart.getTime() + selectedService.duration * 60 * 1000);

  const now = new Date();
  const today = new Date();
  const todayString =
    today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");

  if (date === todayString && slotStart <= now) {
    return false;

  }

// 1. Lokālie bookingi
const hasLocalConflict = bookings.some(booking => {
  if (booking.status === "cancelled") return false;
  if (booking.date !== date) return false;

  const bookedDuration = getServiceDurationByName(booking.service);
  const bookingStart = getDateTime(booking.date, booking.time);
  const BUFFER_MINUTES = 15;

  const bookingStartWithBuffer = new Date(
    bookingStart.getTime() - BUFFER_MINUTES * 60 * 1000
  );

  const bookingEnd = new Date(
    bookingStart.getTime() + (bookedDuration + BUFFER_MINUTES) * 60 * 1000
  );

  return overlaps(slotStart, slotEnd, bookingStartWithBuffer, bookingEnd);
});


  // 2. Google Calendar
const BUFFER_MINUTES = 15;

const hasGoogleConflict = googleBusy.some(event => {
  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);

const eventStartWithBuffer = new Date(
  eventStart.getTime() - BUFFER_MINUTES * 60 * 1000
);

  const eventEndWithBuffer = new Date(
    eventEnd.getTime() + BUFFER_MINUTES * 60 * 1000
  );

return overlaps(slotStart, slotEnd, eventStartWithBuffer, eventEndWithBuffer);
});



  return !hasLocalConflict && !hasGoogleConflict;
});

    res.json(freeSlots);

  } catch (err) {
    console.error("Slots error:", err);
    res.status(500).json({ error: "server error" });
  }
});

app.put(["/availability/:index", "/kristina/availability/:index"], (req, res) => {
  try {
    const index = Number(req.params.index);
    const { serviceId, weekday, from, to, active } = req.body;

    const availability = loadAvailability();

    if (index >= 0 && availability[index]) {
      availability[index] = {
        ...availability[index],
        from,
        to,
        active
      };
    } else {
      availability.push({
        serviceId,
        weekday,
        from,
        to,
        active
      });
    }

    fs.writeFileSync(AVAILABILITY_PATH, JSON.stringify(availability, null, 2));

    res.json({ status: "ok" });
  } catch (err) {
    console.error("Update availability error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// admin rezervāciju saraksts
app.get(["/bookings", "/kristina/bookings"], (req, res) => {
  try {
    const bookings = loadBookings().map((booking, index) => ({
      ...booking,
      index
    }));

    res.json(bookings);
  } catch (err) {
    console.error("Kļūda nolasot bookings:", err);
    res.status(500).json({
      status: "error",
      message: "Neizdevās nolasīt rezervācijas."
    });
  }
});

app.get(["/crm/clients", "/kristina/crm/clients"], (req, res) => {
  try {
    const bookings = loadBookings();

    const clientsMap = {};

    bookings.forEach((booking) => {
      if (!booking.email) return;

      const email = booking.email.trim().toLowerCase();

      if (!clientsMap[email]) {
        clientsMap[email] = {
          email,
          name: booking.name || "",
          phone: booking.phone || "",
          bookingsCount: 0,
          lastBookingDate: booking.date || "",
          lastService: booking.service || "",
          status: booking.status || "active"
        };
      }

      clientsMap[email].bookingsCount += 1;

      // jaunākā rezervācija
      if (
        booking.date &&
        booking.date > clientsMap[email].lastBookingDate
      ) {
        clientsMap[email].lastBookingDate = booking.date;
        clientsMap[email].lastService = booking.service || "";
        clientsMap[email].status = booking.status || "active";
      }
    });

    const clients = Object.values(clientsMap)
      .sort((a, b) =>
        (b.lastBookingDate || "").localeCompare(a.lastBookingDate || "")
      );

    res.json(clients);

  } catch (err) {
    console.error("CRM clients error:", err);

    res.status(500).json({
      error: "Neizdevās ielādēt CRM klientus"
    });
  }
});

app.get(["/crm/client-data", "/kristina/crm/client-data"], async (req, res) => {
  try {
    const filePath = path.join(__dirname, "data", "crm-clients.json");

    const raw = await fsp.readFile(filePath, "utf8");

    const data = JSON.parse(raw || "[]");

    res.json(data);

  } catch (err) {
    console.error("CRM client-data error:", err);

    res.status(500).json({
      error: "Neizdevās nolasīt CRM klientu datus"
    });
  }
});

app.post(["/crm/client-data", "/kristina/crm/client-data"], async (req, res) => {
  try {
    const filePath = path.join(__dirname, "data", "crm-clients.json");
    const incoming = req.body;

    if (!incoming.email) {
      return res.status(400).json({ error: "Email obligāts" });
    }

    const email = incoming.email.trim().toLowerCase();

    let data = [];

    try {
      const raw = await fsp.readFile(filePath, "utf8");
      data = JSON.parse(raw || "[]");
    } catch (readErr) {
      data = [];
    }

    const existingIndex = data.findIndex(
      item => String(item.email || "").trim().toLowerCase() === email
    );

    const savedClient = {
      ...incoming,
      email,
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      data[existingIndex] = {
        ...data[existingIndex],
        ...savedClient
      };
    } else {
      data.push({
        ...savedClient,
        createdAt: new Date().toISOString()
      });
    }

    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");

    res.json({
      status: "ok",
      client: savedClient
    });

  } catch (err) {
    console.error("CRM client-data save error:", err);
    res.status(500).json({ error: "Neizdevās saglabāt CRM klientu datus" });
  }
});




app.delete(["/bookings/:index", "/kristina/bookings/:index"], async (req, res) => {
  try {
    const index = Number(req.params.index);
    const bookings = loadBookings();

    if (index < 0 || index >= bookings.length) {
      return res.status(404).json({
        status: "error",
        message: "Booking nav atrasts"
      });
    }

    const deletedBooking = bookings[index];

    if (deletedBooking.eventId) {
      try {
        const auth = await authorize();
        const calendar = google.calendar({ version: "v3", auth });

        await calendar.events.delete({
          calendarId: "primary",
          eventId: deletedBooking.eventId
        });

        console.log("Dzēsts Google Calendar event:", deletedBooking.eventId);
      } catch (calendarErr) {
        console.error("Kļūda dzēšot Google Calendar event:", calendarErr);
      }
    }

    bookings.splice(index, 1);
    saveBookings(bookings);

    res.json({
      status: "ok",
      deletedBooking
    });
  } catch (err) {
    console.error("Kļūda dzēšot booking:", err);
    res.status(500).json({
      status: "error",
      message: "Neizdevās izdzēst booking"
    });
  }
});

app.get(["/cancel/:token", "/kristina/cancel/:token"], async (req, res) => {
  try {
    const { token } = req.params;
    const bookings = loadBookings();

    const bookingIndex = bookings.findIndex(b => b.cancelToken === token);

    if (bookingIndex === -1) {
      return res.status(404).send("Rezervācija nav atrasta vai jau ir atcelta.");
    }

    const booking = bookings[bookingIndex];

    if (booking.status === "cancelled") {
      return res.send("Šī rezervācija jau ir atcelta.");
    }

    if (booking.eventId) {
      try {
        const auth = await authorize();
        const calendar = google.calendar({ version: "v3", auth });

        await calendar.events.delete({
          calendarId: "primary",
          eventId: booking.eventId
        });
      } catch (calendarErr) {
        console.error("Kļūda dzēšot Google Calendar event:", calendarErr);
      }
    }

    bookings[bookingIndex] = {
      ...booking,
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      eventId: null
    };

    saveBookings(bookings);

res.send(`
<!DOCTYPE html>
<html lang="lv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rezervācija atcelta</title>
  <link rel="stylesheet" href="/kristina/assets/css/cancel.css">
</head>
<body>
  <main class="cancel-page">
    <section class="cancel-card">
      <h1>Saruna ir atcelta</h1>
      <p>
        Nekas — aprunāsimies citreiz. Kad būsi gatavs, vari izvēlēties citu laiku.
      </p>

      <div class="cancel-actions">
        <a href="/kristina/" class="cancel-btn cancel-btn-primary">Uz sākumlapu</a>
        <a href="/kristina/#konsultacijas" class="cancel-btn cancel-btn-secondary">Izvēlēties citu laiku</a>
      </div>
    </section>
  </main>
</body>
</html>
`);

  } catch (err) {
    console.error("Cancel error:", err);
    res.status(500).send("Neizdevās atcelt rezervāciju.");
  }
});

// booking route
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendBookingNotification(booking, meetLink) {
  try {
    await transporter.sendMail({
      from: `"Kristīna Kaņepe" <${process.env.SMTP_USER}>`,
      to: "kristina.kanepe@gmail.com",
      subject: `Jauna rezervācija — ${booking.service}`,
      text:
`Jauna rezervācija

Pakalpojums: ${booking.service}
Datums: ${booking.date}
Laiks: ${booking.time}

Klients: ${booking.name}
E-pasts: ${booking.email}
Telefons: ${booking.phone}

Sarunas mērķis:
${booking.goal || "-"}

Google Meet:
${meetLink || "-"}

`
    });

    console.log("Notification email sent");
  } catch (err) {
    console.error("Email send error:", err);
  }
}

app.post(["/booking", "/kristina/booking"], async (req, res) => {
  try {
    const newBooking = req.body;

    const bookings = loadBookings();

const auth = await authorize();
const calendar = google.calendar({ version: "v3", auth });
const cancelToken = Math.random().toString(36).substring(2, 12);
const startDate = new Date(`${newBooking.date}T${newBooking.time}:00`);
const endDate = getEndDateTime(newBooking.date, newBooking.time, newBooking.service);

const event = await calendar.events.insert({
  calendarId: "primary",
  sendUpdates: "all",
  conferenceDataVersion: 1,
  resource: {
    summary: newBooking.service,
description:
  "Labdien!\n\n" +

  "Paldies par uzticēšanos un pieteikumu uz sesiju.\n\n" +

  "Mēdz teikt, ka lielas pārmaiņas sākas brīdī, kad mēs uzdrīkstamies apstāties un pa īstam ieklausīties sevī. Man būs patiess prieks būt Tev līdzās šajā procesā, palīdzot sakārtot domas un ieraudzīt situāciju no cita, plašāka skatu punkta.\n\n" +

  "Mūsu tikšanās ir apstiprināta.\n\n" +

  "Ja Tev līdz tam rodas kādi jautājumi vai ir kas savarīgs, ko vēlies precizēt, droši dod ziņu.\n\n" +

  "Šajā e-pastā esmu pievienojusi linku uz Google Meet platformu, kur notiks saruna.\n\n" +

  "Uz tikšanos,\n\n" +
  "Kristīna Kaņepe\n\n" +
  "Tālr.26465779\n\n" +

  "-----------------------------------\n\n" +

  "Klients: " + newBooking.name + "\n" +
  "E-pasts: " + newBooking.email + "\n" +
  "Telefons: " + newBooking.phone + "\n" +
  "Sarunas mērķis: " + (newBooking.goal || "-") + "\n\n" +

  "-----------------------------------\n\n" +

  "Ja nepieciešams atcelt rezervāciju:\n" +
  "http://185.219.156.43/kristina/cancel/" + cancelToken,
    attendees: [
      { email: newBooking.email }
    ],
conferenceData: {
  createRequest: {
    requestId: cancelToken
  }
},

    reminders: {
    useDefault: false,
    overrides: [
     { method: "email", minutes: 1440 },
     { method: "popup", minutes: 60 }
    ]
  },
    start: {
      dateTime: startDate.toISOString(),
      timeZone: "Europe/Riga"
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: "Europe/Riga"
    }
  }
});

const savedBooking = {
  ...newBooking,
  createdAt: new Date().toISOString(),
  eventId: event.data.id || null,
  cancelToken,
  status: "active"
};

bookings.push(savedBooking);
saveBookings(bookings);

console.log("Saglabāts booking:", savedBooking);
console.log("Event added to Google Calendar");
await sendBookingNotification(
  savedBooking,
  event.data.hangoutLink
);

res.json({
  status: "ok",
  eventLink: event.data.htmlLink || null
});

  } catch (err) {
    console.error("Calendar/server error:", err);
    res.status(500).json({
      status: "error",
      message: "Neizdevās izveidot rezervāciju vai kalendāra ierakstu."
    });
  }
});

app.listen(3001, () => {
  console.log("Serveris palaists uz http://localhost:3000");
});
