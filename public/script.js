const socket = io();

// ------------------------------------
// ELEMENTOS DOM
// ------------------------------------

const playerBoard = document.getElementById("playerBoard");
const enemyBoard = document.getElementById("enemyBoard");
const enemyWrapper = document.getElementById("enemyWrapper");

const statusDisplay = document.getElementById("status");
const rotateBtn = document.getElementById("rotateBtn");
const orientationInfo = document.getElementById("orientationInfo");

const shipButtons = document.querySelectorAll(".shipBtn");

const postGameMenu = document.getElementById("postGameOptions");
const btnRematch = document.getElementById("btnRematch");
const btnNewMatch = document.getElementById("btnNewMatch");

// POP-UP
const rematchPopup = document.getElementById("rematchPopup");
const popupAccept = document.getElementById("popupAccept");
const popupDecline = document.getElementById("popupDecline");

let popupActive = false;

// ------------------------------------
// Variáveis do Jogo
// ------------------------------------

let myId = null;
let myRoom = null;

let myTurn = false;

let placingShip = null;
let orientation = "horizontal";

// VALIDAÇÃO: só 1 navio de cada tipo
let shipsAllowed = {
  5: 1,
  4: 1,
  3: 1,
};

let shipsPlacedCount = {
  5: 0,
  4: 0,
  3: 0,
};

let placedShips = [];

let previewCells = [];
let attackedCells = new Set();

// ------------------------------------
// Inicialização
// ------------------------------------

createBoard(playerBoard, "player");
createBoard(enemyBoard, "enemy");

function createBoard(board, type) {
  board.innerHTML = "";

  board.appendChild(coordCell(""));
  for (let x = 0; x < 10; x++)
    board.appendChild(coordCell(String.fromCharCode(65 + x)));

  for (let y = 0; y < 10; y++) {
    board.appendChild(coordCell(y));

    for (let x = 0; x < 10; x++) {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.x = x;
      cell.dataset.y = y;

      if (type === "enemy") {
        cell.addEventListener("click", () => onAttack(x, y));
      } else {
        cell.addEventListener("mouseenter", () => shipPreview(x, y));
        cell.addEventListener("mouseleave", () => clearPreview());
        cell.addEventListener("click", () => placeShip(x, y));
      }
      board.appendChild(cell);
    }
  }
}

function coordCell(text) {
  const c = document.createElement("div");
  c.classList.add("coord-top");
  c.innerText = text;
  return c;
}

// ------------------------------------
// Seleção de Navio
// ------------------------------------

shipButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const size = parseInt(btn.dataset.size);

    if (shipsPlacedCount[size] >= shipsAllowed[size]) {
      statusDisplay.innerText = "Você já usou todos os navios desse tipo!";
      return;
    }

    placingShip = size;
    statusDisplay.innerText = `Selecionado navio de tamanho: ${placingShip}`;
  });
});

// ------------------------------------
// Rotação
// ------------------------------------

rotateBtn.addEventListener("click", () => {
  orientation = orientation === "horizontal" ? "vertical" : "horizontal";
  orientationInfo.innerText = "Orientação: " + orientation;
});

// ------------------------------------
// Preview de Navio
// ------------------------------------

function shipPreview(x, y) {
  if (!placingShip) return;

  clearPreview();

  let valid = true;
  let cells = [];

  for (let i = 0; i < placingShip; i++) {
    let px = orientation === "horizontal" ? x + i : x;
    let py = orientation === "vertical" ? y + i : y;

    if (px > 9 || py > 9) {
      valid = false;
      break;
    }

    const cell = getPlayerCell(px, py);
    if (cell.classList.contains("ship")) valid = false;

    cells.push(cell);
  }

  previewCells = cells;

  for (const c of cells) {
    c.classList.add(valid ? "preview-valid" : "preview-invalid");
  }
}

function clearPreview() {
  for (const c of previewCells) {
    c.classList.remove("preview-valid", "preview-invalid");
  }
  previewCells = [];
}

// ------------------------------------
// Posicionar Navio
// ------------------------------------

function placeShip(x, y) {
  if (!placingShip) return;

  if (shipsPlacedCount[placingShip] >= shipsAllowed[placingShip]) {
    statusDisplay.innerText = "Você já utilizou todos desse tipo!";
    return;
  }

  let valid = true;
  let coords = [];

  for (let i = 0; i < placingShip; i++) {
    let px = orientation === "horizontal" ? x + i : x;
    let py = orientation === "vertical" ? y + i : y;

    if (px > 9 || py > 9) {
      valid = false;
      break;
    }

    const cell = getPlayerCell(px, py);
    if (cell.classList.contains("ship")) valid = false;

    coords.push({ x: px, y: py });
  }

  if (!valid) {
    statusDisplay.innerText = "Posição inválida!";
    return;
  }

  for (const c of coords) {
    const cell = getPlayerCell(c.x, c.y);
    cell.classList.add("ship");
    cell.classList.add(`size-${placingShip}`);  // aplica imagem correta
  }


  for (const c of coords) {
    getPlayerCell(c.x, c.y).classList.add("ship");
  }

  placedShips.push({
    x,
    y,
    size: placingShip,
    orientation,
  });

  shipsPlacedCount[placingShip]++;

  placingShip = null;
  statusDisplay.innerText = "Navio posicionado!";
  clearPreview();

  if (placedShips.length === 3) {
    socket.emit("placeShips", placedShips);
    statusDisplay.innerText = "Aguardando adversário...";
  }
}

// ------------------------------------
// Auxiliares
// ------------------------------------

function getPlayerCell(x, y) {
  return playerBoard.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
}

function getEnemyCell(x, y) {
  return enemyBoard.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
}

// ------------------------------------
// Atacar
// ------------------------------------

function onAttack(x, y) {
  if (!myTurn || popupActive) return;

  const key = `${x},${y}`;

  if (attackedCells.has(key)) {
    statusDisplay.innerText = "Você já atacou essa posição!";
    return;
  }

  attackedCells.add(key);
  socket.emit("attack", { x, y });
}

// ------------------------------------
// SOCKETS
// ------------------------------------

socket.on("joinedRoom", (room) => {
  myRoom = room;
  myId = socket.id;

  document.getElementById("playerId").innerText = myId;
  document.getElementById("roomId").innerText = myRoom;

  statusDisplay.innerText = "Aguardando jogador...";
});

socket.on("startGame", () => {
  statusDisplay.innerText = "Adversário conectado! Posicione seus navios.";
});

socket.on("readyToPlay", () => {
  statusDisplay.innerText = "Partida iniciada!";
});

socket.on("turnUpdate", ({ turn }) => {
  myTurn = turn === myId;

  if (myTurn) {
    statusDisplay.innerText = "Seu turno!";
    enemyWrapper.classList.remove("enemy-disabled");
    enemyWrapper.classList.add("enemy-enabled");
  } else {
    statusDisplay.innerText = "Turno do inimigo...";
    enemyWrapper.classList.add("enemy-disabled");
    enemyWrapper.classList.remove("enemy-enabled");
  }
});

socket.on("attackResult", ({ attacker, x, y, result }) => {
  const cell =
    attacker === myId ? getEnemyCell(x, y) : getPlayerCell(x, y);

  if (result === "hit") {
    cell.classList.add("hit");
    cell.innerText = "❌";
  } else {
    cell.classList.add("miss");
    cell.innerText = "●";
  }
});

socket.on("gameOverOptions", ({ winner }) => {
  if (winner === myId) {
    statusDisplay.innerText = "🎉 Você venceu!";
  } else {
    statusDisplay.innerText = "❌ Você perdeu!";
  }

  postGameMenu.style.display = "block";
});

// ------------------------------------
// REVANCHE
// ------------------------------------

btnRematch.addEventListener("click", () => {
  socket.emit("rematchRequest");
  statusDisplay.innerText = "Revanche solicitada...";
});

// Adversário pediu revanche → mostrar popup
socket.on("opponentRematchRequest", () => {
  rematchPopup.classList.remove("hidden");
  popupActive = true;
});

// Aceitar revanche
popupAccept.addEventListener("click", () => {
  rematchPopup.classList.add("hidden");
  popupActive = false;
  socket.emit("rematchRequest");
});

// Recusar revanhce
popupDecline.addEventListener("click", () => {
  rematchPopup.classList.add("hidden");
  popupActive = false;
  statusDisplay.innerText = "Você recusou a revanche.";
});

// Ambos aceitaram
socket.on("rematchStart", () => {
  resetBoards();
  placedShips = [];
  shipsPlacedCount = { 5: 0, 4: 0, 3: 0 };
  attackedCells.clear();

  postGameMenu.style.display = "none";
  rematchPopup.classList.add("hidden");

  statusDisplay.innerText =
    "Revanche iniciada! Posicione seus navios.";
});

// ------------------------------------
// NOVA PARTIDA
// ------------------------------------

btnNewMatch.addEventListener("click", () => {
  socket.emit("newMatchRequest");
});

// servidor manda reset completo
socket.on("forceReset", () => {
  resetBoards();
  placedShips = [];
  shipsPlacedCount = { 5: 0, 4: 0, 3: 0 };
  attackedCells.clear();

  postGameMenu.style.display = "none";
  statusDisplay.innerText = "Nova partida criada! Aguardando jogador...";
});

// ------------------------------------
// Utils
// ------------------------------------

function resetBoards() {
  createBoard(playerBoard, "player");
  createBoard(enemyBoard, "enemy");
}

socket.on("playerLeft", () => {
  statusDisplay.innerText = "O adversário saiu.";
});
