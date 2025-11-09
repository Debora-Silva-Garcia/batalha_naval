// Conecta ao servidor
const socket = io();

// Referências de elementos HTML
const playerIdElem = document.getElementById("playerId");
const roomIdElem = document.getElementById("roomId");
const statusElem = document.getElementById("status");
const playerBoard = document.getElementById("playerBoard");
const enemyBoard = document.getElementById("enemyBoard");
const orientationInfo = document.getElementById("orientationInfo");

// Estado local
const BOARD_SIZE = 10;
let playerShips = [];
let isPlacingShips = true;
let placedShips = 0;
let selectedShipSize = null;
let selectedShipButton = null;
let orientation = "horizontal";
const TOTAL_SHIPS = 3;

// ===== Seleção de embarcações =====
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

// ===== Criação de tabuleiros =====
function createBoard(boardElement, isPlayerBoard) {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x = x;
      cell.dataset.y = y;

      if (isPlayerBoard) {
        cell.addEventListener("click", () => placeShip(x, y, cell));
      } else {
        cell.addEventListener("click", () => attackEnemy(x, y, cell));
      }

      boardElement.appendChild(cell);
    }
  }
}

createBoard(playerBoard, true);
createBoard(enemyBoard, false);

// ===== Posicionamento de navios =====
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

// ===== Ataques =====
function attackEnemy(x, y, cell) {
  if (isPlacingShips) return alert("Posicione todos os navios primeiro!");
  if (cell.classList.contains("hit") || cell.classList.contains("miss")) return;
  socket.emit("attack", { x, y });
  statusElem.textContent = `Você atacou [${x}, ${y}]`;
}

// ===== Eventos do servidor =====
socket.on("connect", () => {
  playerIdElem.textContent = socket.id;
  statusElem.textContent = "Conectado! Aguardando pareamento...";
  socket.emit("joinGame");
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

socket.on("yourTurn", () => {
  statusElem.textContent = "🟢 Seu turno! Escolha uma célula no tabuleiro inimigo.";
});

socket.on("playerLeft", (playerId) => {
  statusElem.textContent = `⚠️ O jogador ${playerId} saiu. A sala será encerrada.`;
  roomIdElem.textContent = "Sala desconectada";
});

// ===== Feedback visual de ataques =====
socket.on("attackResult", (data) => {
  const { attacker, x, y, result } = data;
  const isMyAttack = attacker === socket.id;

  const board = isMyAttack ? enemyBoard : playerBoard;
  const cell = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if (!cell) return;

  if (result === "hit") {
    cell.textContent = "❌";
    cell.classList.add("hit");
  } else {
    cell.textContent = "●";
    cell.classList.add("miss");
  }
});

// ===== Fim de jogo =====
socket.on("gameOver", (data) => {
  const msg =
    data.winner === socket.id
      ? "🎉 Você venceu!"
      : "💥 Você foi derrotado!";
  alert(msg);
  statusElem.textContent = msg;
});
