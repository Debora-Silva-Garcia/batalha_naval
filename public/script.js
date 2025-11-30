const socket = io();

// Elementos
const playerIdElem = document.getElementById("playerId");
const roomIdElem = document.getElementById("roomId");
const statusElem = document.getElementById("status");
const playerBoard = document.getElementById("playerBoard");
const enemyBoard = document.getElementById("enemyBoard");
const orientationInfo = document.getElementById("orientationInfo");

// Painel de navios
const shipSelection = document.getElementById("shipSelection");

// Pós-jogo
const postGame = document.getElementById("postGameOptions");
const btnRematch = document.getElementById("btnRematch");
const btnNewMatch = document.getElementById("btnNewMatch");

const BOARD_SIZE = 10;
let playerShips = [];
let isPlacingShips = true;
let placedShips = 0;
let selectedShipSize = null;
let selectedShipButton = null;
let orientation = "horizontal";
let isMyTurn = false;
const TOTAL_SHIPS = 3;

// Variável global para preview
window._previewCells = [];

/* --------------------------------------------------------
   RESET DO PAINEL
-------------------------------------------------------- */
function resetShipPanel() {
  shipSelection.innerHTML = `
    <button class="shipBtn" data-size="5">🚢 Porta Avião (5)</button>
    <button class="shipBtn" data-size="4">🚤 Encouraçado (4)</button>
    <button class="shipBtn" data-size="3">⛵ Submarino (3)</button>
  `;

  document.querySelectorAll(".shipBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedShipSize = parseInt(btn.dataset.size);
      selectedShipButton = btn;
      statusElem.textContent = `Selecionado navio de tamanho ${selectedShipSize}`;
    });
  });

  document.querySelectorAll(".shipBtn").forEach((b) => {
    b.disabled = false;
    b.style.opacity = "1";

    const size = b.dataset.size;
    b.textContent =
      size === "5" ? "🚢 Porta Avião (5)" :
        size === "4" ? "🚤 Encouraçado (4)" :
          "⛵ Submarino (3)";
  });

  orientation = "horizontal";
  orientationInfo.textContent = "Orientação: horizontal";
}

/* --------------------------------------------------------
   ROTACIONAR
-------------------------------------------------------- */
document.getElementById("rotateBtn").addEventListener("click", () => {
  orientation = orientation === "horizontal" ? "vertical" : "horizontal";
  orientationInfo.textContent = `Orientação: ${orientation}`;
});

/* --------------------------------------------------------
   CRIAR TABULEIROS
-------------------------------------------------------- */
function createBoard(boardElement, isPlayerBoard) {
  boardElement.innerHTML = "";

  for (let y = 0; y < BOARD_SIZE; y++) {
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

      boardElement.appendChild(cell);
    }
  }
}

/* --------------------------------------------------------
   RESET COMPLETO (revanche, nova partida)
-------------------------------------------------------- */
function resetBoards() {
  playerShips = [];
  placedShips = 0;
  isPlacingShips = true;
  selectedShipSize = null;
  selectedShipButton = null;

  clearPreview();
  resetShipPanel();
  createBoard(playerBoard, true);
  createBoard(enemyBoard, false);

  postGame.style.display = "none";
  statusElem.textContent = "Posicione seus navios...";
}

/* --------------------------------------------------------
   POSICIONAMENTO FINAL DO NAVIO (click)
-------------------------------------------------------- */
function placeShip(x, y) {
  if (!isPlacingShips) return;
  if (!selectedShipSize) return alert("Escolha uma embarcação primeiro!");

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

  if (!valid) {
    alert("Posição inválida!");
    return;
  }

  shipCells.forEach((c) => c.classList.add("ship"));
  playerShips.push({ x, y, size: selectedShipSize, orientation });

  placedShips++;

  if (selectedShipButton) {
    selectedShipButton.disabled = true;
    selectedShipButton.style.opacity = "0.5";
    selectedShipButton.textContent += " ✅";
    selectedShipButton = null;
  }

  clearPreview();
  selectedShipSize = null;

  if (placedShips >= TOTAL_SHIPS) {
    isPlacingShips = false;
    statusElem.textContent =
      "✅ Todos os navios posicionados! Aguardando adversário...";
    socket.emit("placeShips", playerShips);
  }
}

/* --------------------------------------------------------
   PREVIEW (hover)
-------------------------------------------------------- */
function previewShip(x, y) {
  if (!isPlacingShips || !selectedShipSize) return;

  clearPreview();

  let valid = true;
  const tempCells = [];

  for (let i = 0; i < selectedShipSize; i++) {
    const tx = orientation === "horizontal" ? x + i : x;
    const ty = orientation === "vertical" ? y + i : y;

    if (tx >= BOARD_SIZE || ty >= BOARD_SIZE) valid = false;

    const cell = playerBoard.querySelector(`.cell[data-x="${tx}"][data-y="${ty}"]`);

    if (!cell || cell.classList.contains("ship")) valid = false;

    tempCells.push(cell);
  }

  tempCells.forEach((c) => {
    if (!c) return;
    c.classList.add(valid ? "preview-valid" : "preview-invalid");
  });

  window._previewCells = tempCells;
}

/* --------------------------------------------------------
   LIMPAR PREVIEW
-------------------------------------------------------- */
function clearPreview() {
  window._previewCells.forEach(c => {
    if (!c) return;
    c.classList.remove("preview-valid");
    c.classList.remove("preview-invalid");
  });
  window._previewCells = [];
}

/* --------------------------------------------------------
   ATAQUE
-------------------------------------------------------- */
function attackEnemy(x, y, cell) {
  if (isPlacingShips) return alert("Posicione todos os navios primeiro!");
  if (!isMyTurn) return alert("⏳ Aguarde seu turno!");
  if (cell.classList.contains("hit") || cell.classList.contains("miss")) return;

  socket.emit("attack", { x, y });
  isMyTurn = false;
  statusElem.textContent = `Você atacou [${x}, ${y}]`;
}

/* --------------------------------------------------------
   EVENTOS SOCKET
-------------------------------------------------------- */
socket.on("connect", () => {
  playerIdElem.textContent = socket.id;
  statusElem.textContent = "Conectado! Aguardando pareamento...";
});

socket.on("joinedRoom", (roomId) => {
  roomIdElem.textContent = roomId;
  statusElem.textContent = "Esperando outro jogador...";
});

socket.on("startGame", () => {
  statusElem.textContent = "🌊 Jogo iniciado! Posicione seus navios.";
});

socket.on("readyToPlay", () => {
  statusElem.textContent = "🎯 Ambos prontos! Prepare-se para jogar.";
});

socket.on("turnUpdate", ({ turn }) => {
  isMyTurn = turn === socket.id;
  statusElem.textContent = isMyTurn
    ? "🟢 Seu turno!"
    : "🔴 Turno do adversário...";
});

socket.on("attackResult", ({ attacker, x, y, result }) => {
  const isMyAttack = attacker === socket.id;
  const board = isMyAttack ? enemyBoard : playerBoard;

  const cell = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if (!cell) return;

  cell.textContent = result === "hit" ? "❌" : "●";
  cell.classList.add(result === "hit" ? "hit" : "miss");
});

/* --------------------------------------------------------
   FIM DE JOGO
-------------------------------------------------------- */
socket.on("gameOverOptions", (data) => {
  const msg =
    data.winner === socket.id ? "🎉 Você venceu!" : "💥 Você foi derrotado!";
  statusElem.textContent = msg;
  postGame.style.display = "block";
});

/* --------------------------------------------------------
   REINICIAR PARTIDA
-------------------------------------------------------- */
btnRematch.addEventListener("click", () => {
  postGame.style.display = "none";
  socket.emit("rematchRequest");
  statusElem.textContent = "🔁 Solicitando revanche...";
});

btnNewMatch.addEventListener("click", () => {
  postGame.style.display = "none";
  socket.emit("newMatchRequest");
  statusElem.textContent = "🎲 Procurando nova partida...";
});

/* --------------------------------------------------------
   RESET FORÇADO PELA NOVA PARTIDA
-------------------------------------------------------- */
socket.on("forceReset", () => {
  resetBoards();
  statusElem.textContent = "🎲 Nova partida iniciada! Posicione seus navios.";
});

/* --------------------------------------------------------
   REVANCHE ACEITA
-------------------------------------------------------- */
socket.on("rematchStart", () => {
  resetBoards();
  statusElem.textContent = "🔄 Revanche iniciada! Posicione seus navios.";
});

/* --------------------------------------------------------
   ADVERSÁRIO SAIU
-------------------------------------------------------- */
socket.on("playerLeft", (id) => {
  statusElem.textContent = `⚠️ Jogador ${id} saiu.`;
  createBoard(enemyBoard, false);
});

/* --------------------------------------------------------
   INICIALIZAÇÃO
-------------------------------------------------------- */
resetShipPanel();
createBoard(playerBoard, true);
createBoard(enemyBoard, false);
