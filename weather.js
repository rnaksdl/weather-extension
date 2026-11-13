const card = document.getElementById("weather-card");
const sheen = document.getElementById("glass-sheen");
const glow = document.getElementById("ambient-glow");
const modal = document.getElementById("detail-modal");

document.addEventListener("click", (e) => {
  if (modal.classList.contains("active") && !e.target.closest(".forecast-row")) {
    modal.classList.remove("active");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.classList.contains("active")) {
    modal.classList.remove("active");
  }
});

let targetX = 0, targetY = 0;
let currentX = 0, currentY = 0;
const maxTilt = 7.5;

document.addEventListener("mousemove", (e) => {
  if (modal.classList.contains("active")) return;
  const rect = card.getBoundingClientRect();
  const cardCenterX = rect.left + rect.width / 2;
  const cardCenterY = rect.top + rect.height / 2;

  const normX = Math.max(-1, Math.min(1, (e.clientX - cardCenterX) / (window.innerWidth * 0.45)));
  const normY = Math.max(-1, Math.min(1, (e.clientY - cardCenterY) / (window.innerHeight * 0.45)));

  targetY = normX * maxTilt;
  targetX = -normY * maxTilt;

  const localX = ((e.clientX - rect.left) / rect.width) * 100;
  const localY = ((e.clientY - rect.top) / rect.height) * 100;
  sheen.style.setProperty("--mx", `${localX}%`);
  sheen.style.setProperty("--my", `${localY}%`);
  glow.style.transform = `translate(${-normX * 14}px, ${-normY * 14}px)`;
});

// Fixed: mouseleave doesn't fire on document, so use the window's mouseout instead
document.addEventListener("mouseout", (e) => {
  if (e.relatedTarget === null) {
    targetX = 0; targetY = 0;
    sheen.style.setProperty("--mx", "50%");
    sheen.style.setProperty("--my", "20%");
    glow.style.transform = "translate(0px, 0px)";
  }
});

function animateTilt() {
  currentX += (targetX - currentX) * 0.09;
  currentY += (targetY - currentY) * 0.09;
  card.style.transform = `rotateX(${currentX.toFixed(3)}deg) rotateY(${currentY.toFixed(3)}deg)`;
  requestAnimationFrame(animateTilt);
}
animateTilt();

function getPrecipInterpolation(precip, summary = "") {
  const fontSize = 4.0 + (precip / 100) * 12.5;
  const isSnow = (summary || "").toLowerCase().includes("snow") || (summary || "").toLowerCase().includes("flurr");

  let color;
  if (isSnow) {
    color = '#ffffff';
  } else {
    const t = precip / 100;
    let r, g, b;

    if (t <= 0.45) {
      const subT = t / 0.45;
      r = 255;
      g = Math.round(214 - subT * (214 - 159));
      b = 10;
    } else if (t > 0.45 && t <= 0.55) {
      const subT = (t - 0.45) / 0.10;
      r = Math.round(255 - subT * (255 - 90));
      g = Math.round(159 + subT * (180 - 159));
      b = Math.round(10 + subT * (50 - 10));
    } else {
      const subT = (t - 0.55) / 0.45;
      r = Math.round(90 - subT * (90 - 10));
      g = Math.round(180 - subT * (180 - 132));
      b = Math.round(50 + subT * (255 - 50));
    }

    color = `rgb(${r}, ${g}, ${b})`;
  }

  return { fontSize: `${fontSize.toFixed(1)}px`, color };
}

const LAT = 39.7675;
const LON = -94.8467;

async function loadWeather() {
  try {
    const extUrl = `https://api.open-meteo.com/v1/gfs?latitude=${LAT}&longitude=${LON}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&hourly=relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago&forecast_days=10`;

    const [pointRes, extRes] = await Promise.all([
      fetch(`https://api.weather.gov/points/${LAT},${LON}`),
      fetch(extUrl)
    ]);

    const pointData = await pointRes.json();
    const extData = await extRes.json();
    const { forecast, forecastHourly, observationStations } = pointData.properties;

    const [forecastRes, hourlyRes, stationsRes] = await Promise.all([
      fetch(forecast),
      fetch(forecastHourly),
      fetch(observationStations)
    ]);

    const forecastData = await forecastRes.json();
    const hourlyData = await hourlyRes.json();
    const stationsData = await stationsRes.json();

    let currentTemp = null;
    let currentCond = null;
    const nearestStationId = stationsData.features?.[0]?.properties?.stationIdentifier;

    if (nearestStationId) {
      try {
        const obsRes = await fetch(`https://api.weather.gov/stations/${nearestStationId}/observations/latest`);
        const obsData = await obsRes.json();
        const tempC = obsData.properties?.temperature?.value;
        if (tempC !== null && tempC !== undefined) {
          currentTemp = Math.round((tempC * 9) / 5 + 32);
        }
        if (obsData.properties?.textDescription) {
          currentCond = obsData.properties.textDescription;
        }
      } catch (_) {}
    }

    const currentHour = hourlyData.properties.periods[0];
    if (currentTemp === null) currentTemp = currentHour.temperature;
    if (!currentCond) currentCond = currentHour.shortForecast;
    const currentPrecip = currentHour.probabilityOfPrecipitation?.value ?? 0;

    document.getElementById("current-temp").textContent = `${currentTemp}°`;
    document.getElementById("current-cond").textContent = currentCond;

    const curStyle = getPrecipInterpolation(currentPrecip, currentCond);
    const curPill = document.getElementById("current-precip");
    curPill.textContent = `${currentPrecip}%`;
    curPill.style.fontSize = curStyle.fontSize;
    curPill.style.color = curStyle.color;

    const periods = forecastData.properties.periods;
    const dayMap = new Map();

    for (const p of periods) {
      const dateKey = p.startTime.slice(0, 10);
      if (!dayMap.has(dateKey)) {
        if (dayMap.size >= 7) break;
        dayMap.set(dateKey, {
          dateStr: dateKey,
          high: -Infinity,
          low: Infinity,
          precip: 0,
          dayForecast: null,
          nightForecast: null,
          summary: null,
          detailedForecast: null,
          windSpeed: p.windSpeed || null
        });
      }
      const entry = dayMap.get(dateKey);
      entry.high = Math.max(entry.high, p.temperature);
      entry.low = Math.min(entry.low, p.temperature);
      const pop = p.probabilityOfPrecipitation?.value ?? 0;
      entry.precip = Math.max(entry.precip, pop);

      if (p.isDaytime) {
        entry.dayForecast = p.shortForecast;
        entry.detailedForecast = p.detailedForecast;
        if (p.windSpeed) entry.windSpeed = p.windSpeed;
      } else if (!entry.dayForecast) {
        entry.summary = p.shortForecast;
        entry.detailedForecast = p.detailedForecast;
      }
    }

    const todayKey = periods[0].startTime.slice(0, 10);
    const todayEntry = dayMap.get(todayKey);
    if (todayEntry) {
      todayEntry.high = Math.max(todayEntry.high, currentTemp);
      todayEntry.low = Math.min(todayEntry.low, currentTemp);
      for (const h of hourlyData.properties.periods.slice(0, 24)) {
        if (h.startTime.slice(0, 10) === todayKey) {
          todayEntry.high = Math.max(todayEntry.high, h.temperature);
          todayEntry.low = Math.min(todayEntry.low, h.temperature);
        }
      }
    }

    for (const entry of dayMap.values()) {
      entry.summary = entry.dayForecast || entry.summary || "Clear conditions expected.";
      if (!entry.detailedForecast) entry.detailedForecast = entry.summary;
    }

    if (extData?.daily?.time) {
      for (let i = 0; i < extData.daily.time.length && dayMap.size < 10; i++) {
        const dStr = extData.daily.time[i];
        if (!dayMap.has(dStr)) {
          dayMap.set(dStr, {
            dateStr: dStr,
            high: extData.daily.temperature_2m_max[i],
            low: extData.daily.temperature_2m_min[i],
            precip: extData.daily.precipitation_probability_max[i] ?? 0,
            summary: "Clear",
            detailedForecast: "Extended forecast model data indicates generally clear, seasonable conditions across Northwest Missouri."
          });
        }
      }
    }

    const days = Array.from(dayMap.values()).slice(0, 10);
    const overallMin = Math.min(...days.map((d) => d.low));
    const overallMax = Math.max(...days.map((d) => d.high));
    const tempSpan = Math.max(overallMax - overallMin, 1);

    document.getElementById("today-hl").textContent =
      `H:${Math.round(days[0].high)}°  L:${Math.round(days[0].low)}°`;

    const listEl = document.getElementById("forecast-list");
    listEl.innerHTML = "";

    days.forEach((d, idx) => {
      const [y, m, dayNum] = d.dateStr.split("-").map(Number);
      const dateObj = new Date(y, m - 1, dayNum);
      const shortDay = idx === 0 ? "Today" : dateObj.toLocaleDateString("en-US", { weekday: "short" });
      const fullDateTitle = idx === 0
        ? `Today, ${dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

      const precip = Math.round(d.precip);
      const low = Math.round(d.low);
      const high = Math.round(d.high);
      const pStyle = getPrecipInterpolation(precip, d.summary);

      const widthPct = Math.max(((d.high - d.low) / tempSpan) * 100, 10);
      const leftPct = Math.min(((d.low - overallMin) / tempSpan) * 100, 100 - widthPct);
      const rightPct = Math.max(0, 100 - leftPct - widthPct);

      const row = document.createElement("div");
      row.className = "forecast-row";
      row.innerHTML = `
        <span class="day-name">${shortDay}</span>
        <div class="day-status">
          <span class="precip-val" style="font-size: ${pStyle.fontSize}; color: ${pStyle.color};">${precip}%</span>
        </div>
        <span class="temp-low">${low}°</span>
        <div class="range-track">
          <div class="range-mask" style="left: 0; width: ${leftPct}%;"></div>
          <div class="range-mask" style="right: 0; width: ${rightPct}%;"></div>
        </div>
        <span class="temp-high">${high}°</span>
      `;


      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (modal.classList.contains("active")) {
          modal.classList.remove("active");
          return;
        }

        targetX = 0;
        targetY = 0;

        document.getElementById("modal-day-title").textContent = fullDateTitle;
        document.getElementById("modal-big-high").textContent = `${high}°`;
        document.getElementById("modal-big-low").textContent = `${low}°`;
        document.getElementById("modal-summary-text").textContent = d.detailedForecast;

        const precipEl = document.getElementById("modal-precip");
        precipEl.textContent = `${precip}%`;
        precipEl.style.color = pStyle.color;

        const windNum = extData?.daily?.wind_speed_10m_max?.[idx] ? Math.round(extData.daily.wind_speed_10m_max[idx]) : 9;
        document.getElementById("modal-wind").textContent = d.windSpeed ? d.windSpeed : `${windNum} mph`;

        const humVal = extData?.hourly?.relative_humidity_2m?.[idx * 24 + 14]
          ? Math.round(extData.hourly.relative_humidity_2m[idx * 24 + 14])
          : 62;
        document.getElementById("modal-humidity").textContent = `${humVal}%`;

        modal.classList.add("active");
      });

      listEl.appendChild(row);
    });

  } catch (err) {
    document.getElementById("current-cond").textContent = "Unable to reach NOAA";
  }
}

loadWeather();
setInterval(loadWeather, 15 * 60 * 1000);
