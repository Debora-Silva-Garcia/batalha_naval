const socket = io();

// Elementos
const playerIdElem = document.getElementById("playerId");
const roomIdElem = document.getElementById("roomId");
const statusElem = document.getElementById("status");
const playerBoard = document.getElementById("playerBoard");
const enemyBoard = document.getElementById("enemyBoard");
const orientationInfo = document.getElementById("orientationInfo");

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

// === Seleção de embarcações ===
document.querySelectorAll(".shipBtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedShipSize = parseInt(btn.dataset.size);
    selectedShipButton = btn;
    statusElem.textContent = `Selecionado navio de tamanho ${selectedShipSize}`;
  });
});

document.getElementById("rotateBtn").addEventListener("click", () => {
  orientation = orientation === "horizontal" ? "vertical" : "horizontal";
  orientationInfo.textContent = `Orientação: ${orientation}`;
});

// === Criação de tabuleiros ===
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
      } else {
        cell.addEventListener("click", () => attackEnemy(x, y, cell));
      }

      boardElement.appendChild(cell);
    }
  }
}
createBoard(playerBoard, true);
createBoard(enemyBoard, false);

function resetBoards() {
  playerShips = [];
  placedShips = 0;
  isPlacingShips = true;
  selectedShipSize = null;
  selectedShipButton = null;
  document.querySelectorAll(".shipBtn").forEach((b) => {
    b.disabled = false;
    b.style.opacity = "1";
    b.textContent = `${b.textContent.split(" ")[0]} (${b.dataset.size})`;
  });
  createBoard(playerBoard, true);
  createBoard(enemyBoard, false);
  postGame.style.display = "none";
}

// === Posicionamento ===
function placeShip(x, y) {
  if (!isPlacingShips) return;
  if (!selectedShipSize) return alert("Escolha uma embarcação primeiro!");

  const shipCells = [];
  for (let i = 0; i < selectedShipSize; i++) {
    const tx = orientation === "horizontal" ? x + i : x;
    const ty = orientation === "vertical" ? y + i : y;
    if (tx >= BOARD_SIZE || ty >= BOARD_SIZE)
      return alert("Fora dos limites!");
    const cell = playerBoard.querySelector(`.cell[data-x="${tx}"][data-y="${ty}"]`);
    if (cell.classList.contains("ship"))
      return alert("Sobreposição detectada!");
    shipCells.push(cell);
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

  selectedShipSize = null;
  statusElem.textContent = "Navio posicionado!";

  if (placedShips >= TOTAL_SHIPS) {
    isPlacingShips = false;
    statusElem.textContent = "✅ Todos os navios posicionados! Aguardando adversário...";
    socket.emit("placeShips", playerShips);
  }
}

// === Ataque ===
function attackEnemy(x, y, cell) {
  if (isPlacingShips) return alert("Posicione todos os navios primeiro!");
  if (!isMyTurn) return alert("⏳ Aguarde seu turno!");
  if (cell.classList.contains("hit") || cell.classList.contains("miss")) return;

  socket.emit("attack", { x, y });
  isMyTurn = false;
  statusElem.textContent = `Você atacou [${x}, ${y}]`;
}

// === Eventos ===
socket.on("connect", () => {
  playerIdElem.textContent = socket.id;
  statusElem.textContent = "Conectado! Aguardando pareamento...";
});

socket.on("joinedRoom", (roomId) => {
  roomIdElem.textContent = roomId;
  statusElem.textContent = "Esperando outro jogador...";
});

socket.on("startGame", () => {
  statusElem.textContent = "✅ Jogo iniciado! Posicione seus navios.";
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

// === Feedback visual ===
socket.on("attackResult", ({ attacker, x, y, result }) => {
  const isMyAttack = attacker === socket.id;
  const board = isMyAttack ? enemyBoard : playerBoard;
  const cell = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if (!cell) return;
  cell.textContent = result === "hit" ? "❌" : "●";
  cell.classList.add(result === "hit" ? "hit" : "miss");
});

// === Pós-jogo ===
socket.on("gameOverOptions", (data) => {
  const msg = data.winner === socket.id ? "🎉 Você venceu!" : "💥 Você foi derrotado!";
  statusElem.textContent = msg;
  postGame.style.display = "block";
});

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

socket.on("rematchStart", () => {
  resetBoards();
  statusElem.textContent = "🔄 Revanche iniciada! Posicione seus navios.";
});

socket.on("message", (msg) => (statusElem.textContent = msg));
socket.on("playerLeft", (id) => (statusElem.textContent = `⚠️ Jogador ${id} saiu.`));
