const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

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

app.put("/services/:id", (req, res) => {
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
    if (booking.date !== date) return false;

    const bookedDuration = getServiceDurationByName(booking.service);
    const bookingStart = getDateTime(booking.date, booking.time);
    const BUFFER_MINUTES = 15;
    const bookingEnd = new Date(
        bookingStart.getTime() + (bookedDuration + BUFFER_MINUTES) * 60 * 1000
    );

    return overlaps(slotStart, slotEnd, bookingStart, bookingEnd);
  });

  // 2. Google Calendar
const BUFFER_MINUTES = 15;

const hasGoogleConflict = googleBusy.some(event => {
  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);

  const eventEndWithBuffer = new Date(
    eventEnd.getTime() + BUFFER_MINUTES * 60 * 1000
  );

  return overlaps(slotStart, slotEnd, eventStart, eventEndWithBuffer);
});



  return !hasLocalConflict && !hasGoogleConflict;
});

    res.json(freeSlots);

  } catch (err) {
    console.error("Slots error:", err);
    res.status(500).json({ error: "server error" });
  }
});

app.put("/availability/:index", (req, res) => {
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


// booking route
app.post(["/booking", "/kristina/booking"], async (req, res) => {
  try {
    const newBooking = req.body;

    const bookings = loadBookings();

const auth = await authorize();
const calendar = google.calendar({ version: "v3", auth });

const startDate = new Date(`${newBooking.date}T${newBooking.time}:00`);
const endDate = getEndDateTime(newBooking.date, newBooking.time, newBooking.service);

const event = await calendar.events.insert({
  calendarId: "primary",
  sendUpdates: "all",
  resource: {
    summary: newBooking.service,
    description:
      "Klients: " + newBooking.name + "\n" +
      "Email: " + newBooking.email + "\n" +
      "Telefons: " + newBooking.phone + "\n" +
      "Sarunas mērķis: " + (newBooking.goal || "-"),

    attendees: [
      { email: newBooking.email }
    ],

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
  eventId: event.data.id || null
};

bookings.push(savedBooking);
saveBookings(bookings);

console.log("Saglabāts booking:", savedBooking);
console.log("Event added to Google Calendar");

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
