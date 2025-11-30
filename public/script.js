// script.js (corrigido para não re-habilitar posicionamento após reconexão)
let permanentId = localStorage.getItem("permanentId");

if (!permanentId) {
  permanentId = "p-" + crypto.randomUUID();
  localStorage.setItem("permanentId", permanentId);
}

const socket = io({ query: { permanentId } });

// Elementos
const playerIdElem = document.getElementById("playerId");
const roomIdElem = document.getElementById("roomId");
const statusElem = document.getElementById("status");
const playerBoard = document.getElementById("playerBoard");
const enemyBoard = document.getElementById("enemyBoard");
const orientationInfo = document.getElementById("orientationInfo");
const rotateBtn = document.getElementById("rotateBtn");
const shipButtons = document.querySelectorAll(".shipBtn");

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

// Prev: opção de prevenir cliques rápidos no inimigo
let attackCooldown = false;

// === Seleção de embarcações ===
shipButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    selectedShipSize = parseInt(btn.dataset.size);
    selectedShipButton = btn;
    statusElem.textContent = `Selecionado navio de tamanho ${selectedShipSize}`;
  });
});

if (rotateBtn) {
  rotateBtn.addEventListener("click", () => {
    if (rotateBtn.disabled) return;
    orientation = orientation === "horizontal" ? "vertical" : "horizontal";
    orientationInfo.textContent = `Orientação: ${orientation}`;
  });
}

// === Criação de tabuleiros ===
function createBoard(boardElement, isPlayerBoard) {
  // recria o conteúdo (remove listeners antigos)
  boardElement.innerHTML = "";
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x = x;
      cell.dataset.y = y;

      // Hover para posicionamento (somente se explicitamente for permitido)
      if (isPlayerBoard && isPlacingShips) {
        cell.addEventListener("mouseenter", () => previewPlacement(x, y));
        cell.addEventListener("mouseleave", () => clearPreview());
        cell.addEventListener("click", () => placeShip(x, y));
      } else {
        // tabuleiro sem posicionamento: permitir apenas leitura ou mostrar navios
        // atacável apenas no enemyBoard — as listeners de ataque são adicionadas separadamente
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
  attackCooldown = false;

  shipButtons.forEach((b) => {
    b.disabled = false;
    b.style.opacity = "1";
    b.textContent = b.dataset.label;
  });

  if (rotateBtn) rotateBtn.disabled = false;

  createBoard(playerBoard, true);
  createBoard(enemyBoard, false);

  postGame.style.display = "none";
  statusElem.textContent = "✅ Posicione seus navios.";
}

// === Helpers de preview ===
function previewPlacement(x, y) {
  clearPreview();
  if (!isPlacingShips || !selectedShipSize) return;
  const valid = isPlacementValid(x, y, selectedShipSize, orientation);

  for (let i = 0; i < selectedShipSize; i++) {
    const tx = orientation === "horizontal" ? x + i : x;
    const ty = orientation === "vertical" ? y + i : y;
    const cell = playerBoard.querySelector(`.cell[data-x="${tx}"][data-y="${ty}"]`);
    if (!cell) continue;
    cell.classList.add(valid ? "preview-valid" : "preview-invalid");
  }
}

function clearPreview() {
  // remove classes de preview
  playerBoard.querySelectorAll(".cell").forEach((c) => {
    c.classList.remove("preview-valid", "preview-invalid");
  });
}

function isPlacementValid(x, y, size, orientationCheck) {
  for (let i = 0; i < size; i++) {
    const tx = orientationCheck === "horizontal" ? x + i : x;
    const ty = orientationCheck === "vertical" ? y + i : y;
    if (tx >= BOARD_SIZE || ty >= BOARD_SIZE) return false;
    const cell = playerBoard.querySelector(`.cell[data-x="${tx}"][data-y="${ty}"]`);
    if (!cell) return false;
    if (cell.classList.contains("ship")) return false;
  }
  return true;
}

// === Posicionamento ===
function placeShip(x, y) {
  if (!isPlacingShips) return;
  if (!selectedShipSize) return alert("Escolha uma embarcação primeiro!");
  if (!isPlacementValid(x, y, selectedShipSize, orientation)) return alert("Posição inválida!");

  const shipCells = [];
  for (let i = 0; i < selectedShipSize; i++) {
    const tx = orientation === "horizontal" ? x + i : x;
    const ty = orientation === "vertical" ? y + i : y;
    const cell = playerBoard.querySelector(`.cell[data-x="${tx}"][data-y="${ty}"]`);
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
    // desabilita UI de posicionamento localmente (proteção extra)
    shipButtons.forEach((b) => { b.disabled = true; b.style.opacity = '0.5'; });
    if (rotateBtn) rotateBtn.disabled = true;
    socket.emit("placeShips", playerShips);
  }
}

// === Ataque ===
function attackEnemy(x, y, cell) {
  if (isPlacingShips) return alert("Posicione todos os navios primeiro!");
  if (!isMyTurn) return alert("⏳ Aguarde seu turno!");
  if (cell.classList.contains("hit") || cell.classList.contains("miss")) return;
  if (attackCooldown) return;

  attackCooldown = true;
  setTimeout(() => (attackCooldown = false), 300);

  socket.emit("attack", { x, y });

  isMyTurn = false;
  statusElem.textContent = `Você atacou [${x}, ${y}]`;
}

// função utilitária para habilitar listeners de ataque no enemyBoard (recria cells e listeners)
function buildEnemyBoardListeners() {
  // recria o grid (remove listeners antigos)
  enemyBoard.innerHTML = "";
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.addEventListener("click", () => attackEnemy(x, y, cell));
      enemyBoard.appendChild(cell);
    }
  }
}

// === Eventos Socket ===
socket.on("connect", () => {
  playerIdElem.textContent = permanentId;
  statusElem.textContent = "Conectado! Aguardando pareamento...";
});

// RESTORE: quando reconecta, garantir que NÃO volte ao modo de posicionamento
socket.on("restoreGameState", (state) => {
  statusElem.textContent = "🔄 Reconectado — restaurando partida...";

  // 1) força o cliente a sair do modo de posicionamento
  isPlacingShips = false;
  placedShips = TOTAL_SHIPS;
  selectedShipSize = null;
  selectedShipButton = null;

  // 2) desabilita UI de posicionamento (botões, rotate)
  shipButtons.forEach((b) => { b.disabled = true; b.style.opacity = '0.5'; });
  if (rotateBtn) rotateBtn.disabled = true;

  // 3) monta boards sem listeners de posicionamento e com listeners de ataque no enemy
  createBoard(playerBoard, false); // player board READ-ONLY (mostra navios)
  buildEnemyBoardListeners();      // enemy board com listeners de ataque ativos

  // 4) restaura navios e hits usando permanentId
  playerShips = (state.ships && state.ships[permanentId]) ? state.ships[permanentId] : [];
  isMyTurn = state.turn === permanentId;

  // desenha navios no player board
  for (const ship of playerShips) {
    for (let i = 0; i < ship.size; i++) {
      const x = ship.orientation === "horizontal" ? ship.x + i : ship.x;
      const y = ship.orientation === "vertical" ? ship.y + i : ship.y;
      const cell = playerBoard.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
      if (cell) cell.classList.add("ship");
    }
  }

  // desenha ataques (hits/misses)
  if (state.hitsAgainst) {
    for (const pid of Object.keys(state.hitsAgainst)) {
      for (const h of state.hitsAgainst[pid]) {
        const isMine = h.by === permanentId;
        const board = isMine ? enemyBoard : playerBoard;
        const cell = board.querySelector(`.cell[data-x="${h.x}"][data-y="${h.y}"]`);
        if (!cell) continue;
        cell.textContent = h.result === "hit" ? "❌" : "●";
        cell.classList.add(h.result === "hit" ? "hit" : "miss");
      }
    }
  }

  clearPreview();
  // atualiza estado visual do turno
  enemyBoard.classList.toggle("disabled", !isMyTurn);
  statusElem.textContent = isMyTurn ? "🟢 Seu turno!" : "🔴 Turno do adversário...";
});

socket.on("joinedRoom", (roomId) => {
  roomIdElem.textContent = roomId;
  statusElem.textContent = "Esperando outro jogador...";
});

socket.on("startGame", ({ roomId }) => {
  statusElem.textContent = "✅ Jogo iniciado! Posicione seus navios.";
  roomIdElem.textContent = roomId || roomIdElem.textContent;

  // Quando o jogo inicia naturalmente (não por reconexão),
  // deixamos isPlacingShips como true apenas se o player ainda precisa posicionar.
  // (não alteramos isPlacingShips aqui — o resetBoards() controla isso)
});

socket.on("readyToPlay", () => {
  statusElem.textContent = "🎯 Ambos prontos! Prepare-se para jogar.";
});

socket.on("turnUpdate", ({ turn }) => {
  isMyTurn = turn === permanentId;
  statusElem.textContent = isMyTurn ? "🟢 Seu turno!" : "🔴 Turno do adversário...";
  enemyBoard.classList.toggle("disabled", !isMyTurn);
});

socket.on("yourTurn", () => {
  isMyTurn = true;
  statusElem.textContent = "🟢 Seu turno! (via yourTurn)";
  enemyBoard.classList.remove("disabled");
});

socket.on("attackResult", ({ attacker, x, y, result }) => {
  const isMyAttack = attacker === permanentId;
  const board = isMyAttack ? enemyBoard : playerBoard;
  const cell = board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  if (!cell) return;
  cell.textContent = result === "hit" ? "❌" : "●";
  cell.classList.add(result === "hit" ? "hit" : "miss");
});

socket.on("gameOverOptions", (data) => {
  const msg = data.winner === permanentId ? "🎉 Você venceu!" : "💥 Você foi derrotado!";
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

socket.on("disconnect", () => {
  statusElem.textContent = "⚠️ Desconectado. Tentando reconectar...";
  enemyBoard.classList.add("disabled");
});

socket.on("reconnect_attempt", () => {
  statusElem.textContent = "🔄 Tentando reconectar...";
});

socket.on("reconnect_failed", () => {
  statusElem.textContent = "❌ Falha na reconexão. Recarregue a página.";
});
