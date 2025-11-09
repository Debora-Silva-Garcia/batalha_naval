// Conecta ao servidor
const socket = io();

// Referências de elementos HTML
const playerIdElem = document.getElementById("playerId");
const roomIdElem = document.getElementById("roomId");
const statusElem = document.getElementById("status");
const playerBoard = document.getElementById("playerBoard");
const enemyBoard = document.getElementById("enemyBoard");

// Estado local
const BOARD_SIZE = 10;
let playerShips = [];
let enemyHits = [];
let isPlacingShips = true; // fase inicial
let placedShips = 0;
const TOTAL_SHIPS = 5; // pode ajustar o número de navios

// 🔹 Gera o tabuleiro dinamicamente
function createBoard(boardElement, isPlayerBoard) {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x = x;
      cell.dataset.y = y;

      // Ações diferentes para cada tabuleiro
      if (isPlayerBoard) {
        cell.addEventListener("click", () => placeShip(x, y, cell));
      } else {
        cell.addEventListener("click", () => attackEnemy(x, y, cell));
      }

      boardElement.appendChild(cell);
    }
  }
}

// 🔹 Posiciona navios no próprio tabuleiro
function placeShip(x, y, cell) {
  if (!isPlacingShips) return;
  if (cell.classList.contains("ship")) return;

  cell.classList.add("ship");
  playerShips.push({ x, y });
  placedShips++;

  if (placedShips >= TOTAL_SHIPS) {
    isPlacingShips = false;
    statusElem.textContent = "Navios posicionados! Aguardando adversário...";
    // Aqui futuramente enviaremos os navios ao servidor
    socket.emit("placeShips", playerShips);
  }
}

// 🔹 Dispara um ataque no tabuleiro inimigo
function attackEnemy(x, y, cell) {
  if (isPlacingShips) return alert("Posicione todos os navios primeiro!");
  if (cell.classList.contains("hit") || cell.classList.contains("miss")) return;

  socket.emit("attack", { x, y });
  statusElem.textContent = `Você atacou [${x}, ${y}]`;
}

// Cria ambos os tabuleiros
createBoard(playerBoard, true);
createBoard(enemyBoard, false);

// 🔹 Eventos do servidor
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

// 🔹 (Futuro) Receber resultado de ataques
socket.on("attackResult", (data) => {
  const { x, y, result } = data;
  const cells = enemyBoard.querySelectorAll(".cell");
  const index = y * BOARD_SIZE + x;
  const cell = cells[index];
  if (result === "hit") cell.classList.add("hit");
  else cell.classList.add("miss");
});
