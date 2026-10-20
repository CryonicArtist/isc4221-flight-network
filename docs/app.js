let networkData = null;
let map = null;
let airportMarkers = {};
let routePolylines = [];
let highlightedPolylines = [];

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  fetchData();

  document.getElementById("lookup-btn").addEventListener("click", handleLookup);
  document.getElementById("lookup-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleLookup();
  });

  document.getElementById("check-connection-btn").addEventListener("click", handleConnectionCheck);
  document.getElementById("reset-map-btn").addEventListener("click", resetMapHighlights);
});

function initMap() {
  map = L.map("map").setView([38.0, -96.0], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 10,
    minZoom: 3
  }).addTo(map);
}

async function fetchData() {
  try {
    // Relative path works whether hosted in docs/ or at root of public repo
    const resp = await fetch("data/network.json");
    networkData = await resp.json();
    renderSummary();
    renderDropdowns();
    renderMapNodesAndEdges();
  } catch (err) {
    console.error("Error loading data/network.json:", err);
  }
}

function renderSummary() {
  const s = networkData.summary;
  document.getElementById("stat-airports").innerText = s.total_airports;
  document.getElementById("stat-edges").innerText = s.total_edges;
  document.getElementById("stat-components").innerText = s.num_components;
  document.getElementById("stat-top-hub").innerText = networkData.hubs[0][0];

  // Hubs Bar Chart
  const hubContainer = document.getElementById("hub-barchart");
  hubContainer.innerHTML = "";
  const maxDeg = networkData.hubs[0][1];

  networkData.hubs.forEach(([iata, deg]) => {
    const pct = (deg / maxDeg) * 100;
    const row = document.createElement("div");
    row.className = "bar-row";
    row.onclick = () => selectAirport(iata);
    row.innerHTML = `
      <span class="bar-label">${iata}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${pct}%"></div>
      </div>
      <span class="bar-val">${deg}</span>
    `;
    hubContainer.appendChild(row);
  });

  // Connected Components
  const compContainer = document.getElementById("components-list");
  compContainer.innerHTML = "";
  networkData.components.forEach((comp, idx) => {
    const badge = document.createElement("div");
    badge.className = "comp-badge";
    badge.innerText = `Comp ${idx + 1} (${comp.length} nodes)`;
    badge.onclick = () => highlightComponent(comp);
    compContainer.appendChild(badge);
  });
}

function renderDropdowns() {
  const origSelect = document.getElementById("select-origin");
  const destSelect = document.getElementById("select-dest");
  origSelect.innerHTML = "";
  destSelect.innerHTML = "";

  networkData.sorted_codes.forEach((code) => {
    const name = networkData.airports[code]?.city || code;
    origSelect.add(new Option(`${code} - ${name}`, code));
    destSelect.add(new Option(`${code} - ${name}`, code));
  });

  origSelect.value = "TLH";
  destSelect.value = "SEA";
}

function renderMapNodesAndEdges() {
  const airports = networkData.airports;

  // Base Edges
  networkData.edges.forEach(([u, v]) => {
    if (airports[u] && airports[v]) {
      const line = L.polyline(
        [[airports[u].lat, airports[u].lon], [airports[v].lat, airports[v].lon]],
        { color: "#3182bd", weight: 0.8, opacity: 0.15 }
      ).addTo(map);
      routePolylines.push(line);
    }
  });

  // Airport Markers
  Object.keys(airports).forEach((iata) => {
    const ap = airports[iata];
    const marker = L.circleMarker([ap.lat, ap.lon], {
      radius: Math.max(4, Math.min(12, ap.degree * 0.1)),
      fillColor: ap.degree > 100 ? "#800000" : "#3182bd",
      color: "#000",
      weight: 0.5,
      fillOpacity: 0.8
    }).addTo(map);

    marker.bindTooltip(`<b>${iata}</b> - ${ap.name}<br>Degree: ${ap.degree}`);
    marker.on("click", () => selectAirport(iata));
    airportMarkers[iata] = marker;
  });
}

// Binary Search in JS
function binarySearchJS(sortedCodes, target) {
  let low = 0, high = sortedCodes.length - 1, comparisons = 0;
  while (low <= high) {
    let mid = Math.floor((low + high) / 2);
    comparisons++;
    if (sortedCodes[mid] === target) return { index: mid, comparisons };
    else if (sortedCodes[mid] < target) low = mid + 1;
    else high = mid - 1;
  }
  return { index: -1, comparisons };
}

function handleLookup() {
  const query = document.getElementById("lookup-input").value.trim().toUpperCase();
  if (!query) return;

  const searchRes = binarySearchJS(networkData.sorted_codes, query);
  const container = document.getElementById("lookup-results");

  if (searchRes.index !== -1) {
    const ap = networkData.airports[query];
    const nearest = networkData.nearest[query] || [];
    const directDest = getDirectDestinations(query);

    container.innerHTML = `
      <p><strong>${query}</strong> - ${ap.name} (${ap.city})</p>
      <p><strong>Degree:</strong> ${ap.degree} direct routes</p>
      <p><strong>Binary Search Comparisons:</strong> ${searchRes.comparisons}</p>
      <hr style="margin:8px 0;">
      <p><strong>5 Nearest Airports:</strong> ${nearest.map(n => `${n[0]} (${n[1]} km)`).join(", ")}</p>
      <p><strong>Direct Destinations:</strong> ${directDest.slice(0, 8).join(", ")}${directDest.length > 8 ? "..." : ""}</p>
    `;
    selectAirport(query);
  } else {
    container.innerHTML = `
      <p class="badge-danger">Airport Code '${query}' Not Found in Network.</p>
      <p><strong>Binary Search Comparisons:</strong> ${searchRes.comparisons}</p>
    `;
  }
}

function getDirectDestinations(iata) {
  const dests = [];
  networkData.edges.forEach(([u, v]) => {
    if (u === iata) dests.push(v);
    if (v === iata) dests.push(u);
  });
  return dests;
}

function selectAirport(iata) {
  resetMapHighlights();
  const ap = networkData.airports[iata];
  if (!ap) return;

  map.setView([ap.lat, ap.lon], 6);

  networkData.edges.forEach(([u, v]) => {
    if (u === iata || v === iata) {
      const line = L.polyline(
        [[networkData.airports[u].lat, networkData.airports[u].lon], 
         [networkData.airports[v].lat, networkData.airports[v].lon]],
        { color: "#e41a1c", weight: 2.5, opacity: 0.9 }
      ).addTo(map);
      highlightedPolylines.push(line);
    }
  });

  document.getElementById("lookup-input").value = iata;
}

function highlightComponent(compNodes) {
  resetMapHighlights();
  const nodeSet = new Set(compNodes);

  compNodes.forEach((code) => {
    if (airportMarkers[code]) {
      airportMarkers[code].setStyle({ fillColor: "#ff7f00", radius: 8 });
    }
  });

  networkData.edges.forEach(([u, v]) => {
    if (nodeSet.has(u) && nodeSet.has(v)) {
      const line = L.polyline(
        [[networkData.airports[u].lat, networkData.airports[u].lon], 
         [networkData.airports[v].lat, networkData.airports[v].lon]],
        { color: "#ff7f00", weight: 2, opacity: 0.8 }
      ).addTo(map);
      highlightedPolylines.push(line);
    }
  });
}

// Live Connection Algorithm in JS for Panel D
function pathExistsJS(origin, destination) {
  const adj = {};
  networkData.edges.forEach(([u, v]) => {
    if (!adj[u]) adj[u] = [];
    if (!adj[v]) adj[v] = [];
    adj[u].push(v);
    adj[v].push(u);
  });

  if (!adj[origin] || !adj[destination]) {
    return { found: false, iterations: 0, reached: [] };
  }

  let used = new Set();
  let newSet = new Set([origin]);
  let untouched = new Set(Object.keys(adj).filter(k => k !== origin));
  let n_iterations = 0;

  while (newSet.size > 0) {
    n_iterations++;
    let nextNew = new Set();

    for (let node of newSet) {
      for (let nbr of (adj[node] || [])) {
        if (untouched.has(nbr)) nextNew.add(nbr);
      }
    }

    used = new Set([...used, ...newSet]);
    nextNew.forEach(item => untouched.delete(item));
    newSet = nextNew;

    if (newSet.has(destination)) {
      return { found: true, iterations: n_iterations, fewest_flights: n_iterations, reached: Array.from(used) };
    }
  }

  return { found: false, iterations: n_iterations, fewest_flights: null, reached: Array.from(used) };
}

function handleConnectionCheck() {
  const orig = document.getElementById("select-origin").value;
  const dest = document.getElementById("select-dest").value;
  const container = document.getElementById("connection-results");

  const result = pathExistsJS(orig, dest);
  resetMapHighlights();

  if (result.found) {
    container.innerHTML = `
      <p class="badge-success">✔ Path Exists between ${orig} and ${dest}</p>
      <p><strong>Iterations:</strong> ${result.iterations}</p>
      <p><strong>Fewest Flights:</strong> ${result.fewest_flights} flight(s)</p>
    `;
    airportMarkers[orig]?.setStyle({ fillColor: "#2e7d32", radius: 9 });
    airportMarkers[dest]?.setStyle({ fillColor: "#2e7d32", radius: 9 });
  } else {
    container.innerHTML = `
      <p class="badge-danger">✖ No Path Exists between ${orig} and ${dest}</p>
      <p><strong>Iterations before stopping:</strong> ${result.iterations}</p>
      <p><strong>Total Reachable Nodes Explored:</strong> ${result.reached.length}</p>
    `;
    airportMarkers[orig]?.setStyle({ fillColor: "#c62828", radius: 9 });
    airportMarkers[dest]?.setStyle({ fillColor: "#c62828", radius: 9 });
  }
}

function resetMapHighlights() {
  highlightedPolylines.forEach(line => map.removeLayer(line));
  highlightedPolylines = [];

  Object.keys(airportMarkers).forEach((iata) => {
    const ap = networkData.airports[iata];
    airportMarkers[iata].setStyle({
      radius: Math.max(4, Math.min(12, ap.degree * 0.1)),
      fillColor: ap.degree > 100 ? "#800000" : "#3182bd"
    });
  });
}
