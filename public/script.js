// Establish a connection to the SSE endpoint
const eventSource = new EventSource('/events');

// Global variables to store labels and raw deposit values
let labels = [];
let values = [];

// Create Chart.js instance with initial empty data
const ctx = document.getElementById('realtime-chart').getContext('2d');
const realtimeChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Total Acumulado (R$)',
        data: [],
        fill: true,
        borderColor: '#845ec2',
        backgroundColor: 'rgba(132, 94, 194, 0.2)',
        tension: 0.4,
        pointBackgroundColor: '#b8a6e0',
        pointBorderColor: '#845ec2',
        pointRadius: 4
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        title: {
          display: true,
          text: 'Horário',
          color: '#c9c6e3'
        },
        ticks: {
          color: '#c9c6e3'
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.05)'
        }
      },
      y: {
        title: {
          display: true,
          text: 'Valor (R$)',
          color: '#c9c6e3'
        },
        ticks: {
          color: '#c9c6e3'
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.05)'
        }
      }
    },
    plugins: {
      legend: {
        labels: {
          color: '#c9c6e3'
        },
        onClick: null // disable toggling datasets when clicking legend
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            return `R$ ${context.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
          }
        }
      }
    }
  }
});

/**
 * Helper function to compute cumulative sum of an array of numbers.
 */
function computeCumulative(arr) {
  // Always start with zero to produce a baseline. The returned array
  // will be one element longer than the input.
  const cumulative = [0];
  arr.reduce((sum, val) => {
    const newSum = sum + val;
    cumulative.push(newSum);
    return newSum;
  }, 0);
  return cumulative;
}

/**
 * Update the chart with new labels and raw values.
 * Calculates the cumulative totals for display.
 */
function updateChart(newLabels, newValues) {
  labels = newLabels;
  values = newValues;
  const cumulative = computeCumulative(values);
  // Extend labels array by repeating the first label at the start to
  // align with the extra zero value. If there are no labels, leave empty.
  let extendedLabels = [];
  if (labels.length > 0) {
    extendedLabels = [labels[0], ...labels];
  }
  realtimeChart.data.labels = extendedLabels;
  realtimeChart.data.datasets[0].data = cumulative;
  realtimeChart.update();
}

// Utility to extract query parameters from the URL
function getQueryParams() {
  const params = {};
  window.location.search
    .substring(1)
    .split('&')
    .forEach((pair) => {
      if (!pair) return;
      const [key, value] = pair.split('=');
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
  return params;
}

// Current user from query param, if provided (e.g., ?user=Esther)
const queryParams = getQueryParams();
const currentUser = queryParams.user;

// Update the chart title based on the current user
const chartTitleEl = document.getElementById('chart-title');
if (chartTitleEl) {
  if (currentUser) {
    chartTitleEl.innerText = `Entradas de ${currentUser}`;
  } else {
    chartTitleEl.innerText = 'Evolução da Carteira';
  }
}

// Store Chart.js instances for mini charts (per user)
const miniCharts = {};

// Store latest users data to be used in the detail modal
let latestUsersData = {};

// Track the current total value for animation purposes
let currentTotal = 0;

// Team data to render on the public site
let teamData = [];

/**
 * Helper to sanitize a string into an HTML element ID by replacing spaces and
 * removing special characters.
 * Example: 'Matheus França' -> 'Matheus_Franca'
 */
function sanitizeId(name) {
  return name
    .normalize('NFD')
    // Remove diacritics (accents)
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '');
}

/**
 * Initialize mini charts for any pre-defined cards in the DOM. It loops through
 * all elements with class 'mini-chart-card' and creates Chart.js instances
 * based on the user names in their <h3> tags and canvas elements.
 */
function initializeMiniCharts() {
  const cards = document.querySelectorAll('.mini-chart-card');
  cards.forEach((card) => {
    const nameEl = card.querySelector('h3');
    const canvasEl = card.querySelector('canvas');
    if (nameEl && canvasEl) {
      const user = nameEl.innerText.trim();
      // Ensure canvas has an ID (if not set in HTML)
      if (!canvasEl.id) {
        canvasEl.id = `chart-${sanitizeId(user)}`;
      }
      const ctxMini = canvasEl.getContext('2d');
      miniCharts[user] = new Chart(ctxMini, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Total (R$)',
              data: [],
              fill: true,
              borderColor: '#845ec2',
              backgroundColor: 'rgba(132, 94, 194, 0.2)',
              tension: 0.4,
              pointRadius: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (context) {
                  return `R$ ${context.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
                }
              }
            }
          },
          scales: {
            x: {
              ticks: { display: false },
              grid: { display: false }
            },
            y: {
              ticks: { display: false },
              grid: { display: false }
            }
          }
        }
      });
      // Click event to open detail modal
      card.addEventListener('click', () => showDetailModal(user));
    }
  });
}

/**
 * Dynamically creates a new mini chart card for a user. This function is used
 * when a new user appears in SSE data. It creates DOM elements, appends them
 * to the mini-grid, and initializes a Chart.js instance and click handler.
 */
function createMiniChartCard(user) {
  const grid = document.querySelector('.mini-grid');
  if (!grid) return;
  // Create card container
  const card = document.createElement('div');
  card.classList.add('mini-chart-card');
  // User name title
  const title = document.createElement('h3');
  title.innerText = user;
  card.appendChild(title);
  // Canvas element
  const canvas = document.createElement('canvas');
  const sanitized = sanitizeId(user);
  canvas.id = `chart-${sanitized}`;
  card.appendChild(canvas);
  // Append card to grid
  grid.appendChild(card);
  // Create Chart.js instance
  const ctxMini = canvas.getContext('2d');
  miniCharts[user] = new Chart(ctxMini, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Total (R$)',
          data: [],
          fill: true,
        borderColor: '#845ec2',
        backgroundColor: 'rgba(132, 94, 194, 0.2)',
          tension: 0.4,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context) {
              return `R$ ${context.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { display: false }, grid: { display: false } },
        y: { ticks: { display: false }, grid: { display: false } }
      }
    }
  });
  // Attach click event for detail modal
  card.addEventListener('click', () => showDetailModal(user));
}

/**
 * Show a modal overlay with detailed data for a user, including a larger chart
 * and a table with each entry. It uses the latestUsersData stored from SSE.
 */
let detailChart = null;
function showDetailModal(user) {
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('detail-title');
  const totalEl = document.getElementById('detail-total');
  const tableBody = document.getElementById('detail-table-body');
  const chartCanvas = document.getElementById('detail-chart');
  if (!overlay || !title || !totalEl || !tableBody || !chartCanvas) return;
  // Get data for user
  const userData = latestUsersData[user] || { labels: [], values: [] };
  const labels = userData.labels || [];
  const values = userData.values || [];
  const cumulative = computeCumulative(values);
  // Update chart title
  title.innerText = `Detalhes de ${user}`;
  // Sum total
  const total = values.reduce((sum, v) => sum + v, 0);
  totalEl.innerText = `Total: R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  // Fill table
  tableBody.innerHTML = '';
  labels.forEach((label, idx) => {
    const row = document.createElement('tr');
    const tdTime = document.createElement('td');
    tdTime.innerText = label;
    const tdValue = document.createElement('td');
    tdValue.innerText = `R$ ${values[idx].toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    row.appendChild(tdTime);
    row.appendChild(tdValue);
    tableBody.appendChild(row);
  });
  // Create or update the detail chart
  const ctxDetail = chartCanvas.getContext('2d');
  if (detailChart) {
    // Extend labels for zero baseline if there are values
    let extended = [];
    if (labels.length > 0) {
      extended = [labels[0], ...labels];
    }
    detailChart.data.labels = extended;
    detailChart.data.datasets[0].data = cumulative;
    detailChart.update();
  } else {
    detailChart = new Chart(ctxDetail, {
      type: 'line',
      data: {
        labels: labels.length > 0 ? [labels[0], ...labels] : [],
        datasets: [
          {
            label: 'Total (R$)',
            data: cumulative,
            fill: true,
            borderColor: '#845ec2',
            backgroundColor: 'rgba(132, 94, 194, 0.3)',
            tension: 0.4,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: '#c9c6e3' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          y: {
            ticks: { color: '#c9c6e3' },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#c9c6e3' } },
          tooltip: {
            callbacks: {
              label: function (context) {
                return `R$ ${context.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
              }
            }
          }
        }
      }
    });
  }
  // Show modal
  overlay.style.display = 'flex';
}

// Close detail modal
const closeModalBtn = document.getElementById('close-modal');
if (closeModalBtn) {
  closeModalBtn.addEventListener('click', () => {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'none';
  });
}

/**
 * Render the team section based on the global teamData array.
 * It rebuilds the team-grid div with cards for each member.
 */
function renderTeam() {
  const grid = document.getElementById('team-grid');
  if (!grid) return;
  grid.innerHTML = '';
  teamData.forEach((member) => {
    const card = document.createElement('div');
    card.className = 'team-member';
    const nameEl = document.createElement('h3');
    nameEl.innerText = member.name;
    const descEl = document.createElement('p');
    descEl.innerText = member.description || '';
    card.appendChild(nameEl);
    card.appendChild(descEl);
    grid.appendChild(card);
  });
}

/**
 * Update the total amount displayed above the main chart.
 */
function updateTotalAmount(totalValue) {
  const totalEl = document.getElementById('total-amount');
  if (!totalEl) return;
  const startValue = currentTotal;
  const endValue = totalValue;
  const duration = 800;
  const startTime = performance.now();
  function animate(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const value = startValue + (endValue - startValue) * progress;
    totalEl.innerText = `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      currentTotal = endValue;
    }
  }
  requestAnimationFrame(animate);
}

// Initialize mini charts once DOM is ready
document.addEventListener('DOMContentLoaded', initializeMiniCharts);
// Fetch initial team data on page load
document.addEventListener('DOMContentLoaded', () => {
  fetch('/team')
    .then((res) => res.json())
    .then((data) => {
      teamData = data;
      renderTeam();
    })
    .catch((err) => {
      console.error('Erro ao buscar equipe:', err);
    });
});

// Handle incoming messages from the server
eventSource.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    let labelsToUse = [];
    let valuesToUse = [];
    // If a specific user is requested and user data exists, use it; otherwise, use total
    if (currentUser && data.users && data.users[currentUser]) {
      labelsToUse = data.users[currentUser].labels;
      valuesToUse = data.users[currentUser].values;
    } else {
      labelsToUse = data.totalLabels;
      valuesToUse = data.totalValues;
    }
    updateChart(labelsToUse, valuesToUse);
    // Save latest users data for detail modal
    if (data.users) {
      latestUsersData = data.users;
      // Dynamically create mini chart cards for new users
      Object.keys(data.users).forEach((user) => {
        if (!miniCharts[user]) {
          createMiniChartCard(user);
        }
        // Update existing mini chart data
        const userLabels = data.users[user].labels || [];
        const userValues = data.users[user].values || [];
        const cumulativeUser = computeCumulative(userValues);
        const chartObj = miniCharts[user];
        if (chartObj) {
          // Extend labels for the zero baseline
          let extended = [];
          if (userLabels.length > 0) {
            extended = [userLabels[0], ...userLabels];
          }
          chartObj.data.labels = extended;
          chartObj.data.datasets[0].data = cumulativeUser;
          chartObj.update();
        }
      });
    }

    // Update team data and render team
    if (data.team) {
      teamData = data.team;
      renderTeam();
    }
    // Update total amount display
    if (data.totalValues) {
      const totalSum = data.totalValues.reduce((sum, val) => sum + val, 0);
      updateTotalAmount(totalSum);
    }
  } catch (e) {
    console.error('Erro ao analisar dados do servidor', e);
  }
};