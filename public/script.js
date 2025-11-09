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
let enemyHits = [];
let isPlacingShips = true;
let placedShips = 0;
let selectedShipSize = null;
let selectedShipButton = null;
let orientation = "horizontal";
const TOTAL_SHIPS = 3; // 3 embarcações: 5, 4 e 3

// ===== Seleção de embarcações =====
document.querySelectorAll(".shipBtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedShipSize = parseInt(btn.dataset.size);
    selectedShipButton = btn;
    statusElem.textContent = `Selecionado navio de tamanho ${selectedShipSize}`;
  });
});

// Botão de rotação
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

// ===== Lógica de posicionamento de navios =====
function placeShip(x, y, cell) {
  if (!isPlacingShips) return;
  if (!selectedShipSize) return alert("Escolha uma embarcação primeiro!");

  const shipCells = [];
  for (let i = 0; i < selectedShipSize; i++) {
    const targetX = orientation === "horizontal" ? x + i : x;
    const targetY = orientation === "vertical" ? y + i : y;

    if (targetX >= BOARD_SIZE || targetY >= BOARD_SIZE)
      return alert("Fora dos limites!");

    const targetCell = playerBoard.querySelector(
      `.cell[data-x="${targetX}"][data-y="${targetY}"]`
    );

    if (targetCell.classList.contains("ship"))
      return alert("Sobreposição detectada!");

    shipCells.push(targetCell);
  }

  // Marca visualmente o navio
  shipCells.forEach((c) => c.classList.add("ship"));

  // Registra no estado local
  playerShips.push({ x, y, size: selectedShipSize, orientation });
  placedShips++;

  // Remove o botão correspondente à embarcação colocada
  if (selectedShipButton) {
    selectedShipButton.disabled = true;
    selectedShipButton.style.opacity = "0.5";
    selectedShipButton.textContent += " ✅";
    selectedShipButton = null;
  }

  selectedShipSize = null;
  statusElem.textContent = "Navio posicionado!";

  // Se todas as embarcações foram colocadas
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

socket.on("startGame", (data) => {
  statusElem.textContent = "✅ Jogo iniciado! Posicione seus navios.";
});

socket.on("playerLeft", (playerId) => {
  statusElem.textContent = `⚠️ O jogador ${playerId} saiu. A sala será encerrada.`;
  roomIdElem.textContent = "Sala desconectada";
});

socket.on("attackResult", (data) => {
  const { x, y, result } = data;
  const cells = enemyBoard.querySelectorAll(".cell");
  const index = y * BOARD_SIZE + x;
  const cell = cells[index];
  if (result === "hit") cell.classList.add("hit");
  else cell.classList.add("miss");
});
