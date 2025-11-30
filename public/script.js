const socket = io();

const playerIdElem = document.getElementById("playerId");
const roomIdElem = document.getElementById("roomId");
const statusElem = document.getElementById("status");

const playerBoard = document.getElementById("playerBoard");
const enemyBoard = document.getElementById("enemyBoard");

const orientationInfo = document.getElementById("orientationInfo");
const shipSelection = document.getElementById("shipSelection");

const postGame = document.getElementById("postGameOptions");
const btnRematch = document.getElementById("btnRematch");
const btnNewMatch = document.getElementById("btnNewMatch");

const BOARD_SIZE = 10;

let playerShips = [];
let selectedShipSize = null;
let selectedShipButton = null;
let orientation = "horizontal";
let isPlacingShips = true;
let isMyTurn = false;

let placedShips = 0;
const TOTAL_SHIPS = 3;

window._previewCells = [];

/* --------------------------------------------
   CRIA TABULEIRO ALINHADO
--------------------------------------------- */
function createBoard(boardElement, isPlayerBoard) {
  boardElement.innerHTML = "";

  const grid = document.createElement("div");
  grid.classList.add("board-grid");
  boardElement.appendChild(grid);

  const letters = "ABCDEFGHIJ";

  // canto vazio
  grid.appendChild(document.createElement("div"));

  // letras A–J
  for (let x = 0; x < BOARD_SIZE; x++) {
    const top = document.createElement("div");
    top.classList.add("coord-top");
    top.textContent = letters[x];
    grid.appendChild(top);
  }

  // linhas + células
  for (let y = 0; y < BOARD_SIZE; y++) {
    const left = document.createElement("div");
    left.classList.add("coord-left");
    left.textContent = y + 1;
    grid.appendChild(left);

    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x = x;
      cell.dataset.y = y;

      if (isPlayerBoard) {
        cell.addEventListener("click", () => placeShip(x, y));
        cell.addEventListener("mouseenter", () => previewShip(x, y));
        cell.addEventListener("mouseleave", () => clearPreview());
      } else {
        cell.addEventListener("click", () => attackEnemy(x, y, cell));
      }

      grid.appendChild(cell);
    }
  }
}

/* --------------------------------------------
   RESET COMPLETO
--------------------------------------------- */
function resetBoards() {
  playerShips = [];
  placedShips = 0;
  isPlacingShips = true;
  selectedShipSize = null;

  clearPreview();
  resetShipPanel();
  createBoard(playerBoard, true);
  createBoard(enemyBoard, false);

  postGame.style.display = "none";
  statusElem.textContent = "Posicione seus navios...";
}

/* --------------------------------------------
   PAINEL DE NAVIOS
--------------------------------------------- */
function resetShipPanel() {
  shipSelection.innerHTML = `
    <button class="shipBtn" data-size="5">🚢 Porta Avião (5)</button>
    <button class="shipBtn" data-size="4">🚤 Encouraçado (4)</button>
    <button class="shipBtn" data-size="3">⛵ Submarino (3)</button>
  `;

  document.querySelectorAll(".shipBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedShipSize = parseInt(btn.dataset.size);
      selectedShipButton = btn;
      statusElem.textContent = `Selecionado navio de tamanho ${selectedShipSize}`;
    });
  });

  orientation = "horizontal";
  orientationInfo.textContent = "Orientação: horizontal";
}

document.getElementById("rotateBtn").addEventListener("click", () => {
  orientation = orientation === "horizontal" ? "vertical" : "horizontal";
  orientationInfo.textContent = `Orientação: ${orientation}`;
});

/* --------------------------------------------
   POSICIONAR NAVIO
--------------------------------------------- */
function placeShip(x, y) {
  if (!isPlacingShips) return;
  if (!selectedShipSize) return alert("Selecione um navio!");

  let valid = true;
  const shipCells = [];

  for (let i = 0; i < selectedShipSize; i++) {
    const tx = orientation === "horizontal" ? x + i : x;
    const ty = orientation === "vertical" ? y + i : y;

    if (tx >= BOARD_SIZE || ty >= BOARD_SIZE) valid = false;

    const cell = playerBoard.querySelector(`.cell[data-x="${tx}"][data-y="${ty}"]`);
    if (!cell || cell.classList.contains("ship")) valid = false;

    shipCells.push(cell);
  }

  if (!valid) return alert("Posição inválida!");

  shipCells.forEach(c => c.classList.add("ship"));

  playerShips.push({ x, y, size: selectedShipSize, orientation });

  placedShips++;

  selectedShipButton.disabled = true;
  selectedShipButton.style.opacity = "0.4";
  selectedShipButton = null;
  selectedShipSize = null;

  clearPreview();

  if (placedShips >= TOTAL_SHIPS) {
    isPlacingShips = false;
    statusElem.textContent = "Aguardando adversário...";
    socket.emit("placeShips", playerShips);
  }
}

/* --------------------------------------------
   PREVIEW
--------------------------------------------- */
function previewShip(x, y) {
  if (!isPlacingShips || !selectedShipSize) return;

  clearPreview();

  let valid = true;
  const cells = [];

  for (let i = 0; i < selectedShipSize; i++) {
    const tx = orientation === "horizontal" ? x + i : x;
    const ty = orientation === "vertical" ? y + i : y;

    if (tx >= BOARD_SIZE || ty >= BOARD_SIZE) valid = false;

    const cell = playerBoard.querySelector(`.cell[data-x="${tx}"][data-y="${ty}"]`);
    if (!cell || cell.classList.contains("ship")) valid = false;

    cells.push(cell);
  }

  cells.forEach(c => {
    if (!c) return;
    c.classList.add(valid ? "preview-valid" : "preview-invalid");
  });

  window._previewCells = cells;
}

function clearPreview() {
  window._previewCells.forEach(c => {
    if (!c) return;
    c.classList.remove("preview-valid");
    c.classList.remove("preview-invalid");
  });
  window._previewCells = [];
}

/* --------------------------------------------
   ATAQUE
--------------------------------------------- */
function attackEnemy(x, y, cell) {
  if (isPlacingShips) return alert("Posicione seus navios primeiro!");
  if (!isMyTurn) return alert("Aguarde seu turno!");
  if (cell.classList.contains("hit") || cell.classList.contains("miss")) return;

  socket.emit("attack", { x, y });
  isMyTurn = false;

  statusElem.textContent = `Você atacou [${x}, ${y}]`;
}

/* --------------------------------------------
   SOCKET EVENTOS
--------------------------------------------- */
socket.on("connect", () => {
  playerIdElem.textContent = socket.id;
  statusElem.textContent = "Conectado! Aguardando sala...";
});

socket.on("joinedRoom", (roomId) => {
  roomIdElem.textContent = roomId;
  statusElem.textContent = "Aguardando adversário...";
});

socket.on("startGame", () => {
  statusElem.textContent = "Posicione seus navios.";
});

socket.on("readyToPlay", () => {
  statusElem.textContent = "Jogo iniciado!";
});

socket.on("turnUpdate", ({ turn }) => {
  isMyTurn = turn === socket.id;
  statusElem.textContent = isMyTurn ? "Seu turno!" : "Turno do adversário...";
});

socket.on("attackResult", ({ attacker, x, y, result }) => {
  const isMyAttack = attacker === socket.id;
  const board = isMyAttack ? enemyBoard : playerBoard;

  const cell = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if (!cell) return;

  cell.textContent = result === "hit" ? "❌" : "●";
  cell.classList.add(result === "hit" ? "hit" : "miss");
});

/* --------------------------------------------
   FIM DE JOGO
--------------------------------------------- */
socket.on("gameOverOptions", (data) => {
  statusElem.textContent = (data.winner === socket.id)
    ? "🎉 Você venceu!"
    : "💥 Você perdeu!";

  postGame.style.display = "block";
});

/* --------------------------------------------
   REINICIAR
--------------------------------------------- */
btnRematch.addEventListener("click", () => {
  socket.emit("rematchRequest");
  statusElem.textContent = "Solicitando revanche...";
});

btnNewMatch.addEventListener("click", () => {
  socket.emit("newMatchRequest");
  statusElem.textContent = "Nova partida solicitada...";
});

socket.on("forceReset", resetBoards);
socket.on("rematchStart", resetBoards);

socket.on("playerLeft", () => {
  statusElem.textContent = "O adversário saiu.";
  createBoard(enemyBoard, false);
});

/* --------------------------------------------
   INICIALIZAÇÃO
--------------------------------------------- */
resetBoards();
