const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = {};

io.on("connection", (socket) => {
  console.log("Novo jogador conectado:", socket.id);

  let roomJoined = null;

  // Encontrar ou criar sala
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.length < 2) {
      room.players.push(socket.id);
      roomJoined = roomId;
      break;
    }
  }

  if (!roomJoined) {
    const newRoomId = `room-${socket.id}`;
    rooms[newRoomId] = {
      players: [socket.id],
      ships: {},         // ships[playerId] = [ { x, y, size, orientation }, ... ]
      hitsAgainst: {},   // hitsAgainst[targetId] = [ { x, y, result, by } ]
      turn: null,
      gameStarted: false,
      lock: false
    };
    roomJoined = newRoomId;
  }

  socket.join(roomJoined);
  socket.emit("joinedRoom", roomJoined);
  console.log(`Jogador ${socket.id} entrou na sala ${roomJoined}`);

  const room = rooms[roomJoined];

  // Se a sala estiver completa, iniciar jogo e emitir turno autoritativo
  if (room.players.length === 2) {
    room.gameStarted = true;
    room.turn = room.players[0];
    io.to(roomJoined).emit("startGame", { roomId: roomJoined });
    io.to(roomJoined).emit("turnUpdate", { turn: room.turn });
    console.log(`Jogo iniciado na sala ${roomJoined} - turno: ${room.turn}`);
  }

  // RECEBER POSIÇÕES DOS NAVIOS
  socket.on("placeShips", (ships) => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const r = rooms[roomId];

    r.ships[socket.id] = ships;
    // garante que exista a estrutura hitsAgainst para esse alvo
    if (!Array.isArray(r.hitsAgainst[socket.id])) r.hitsAgainst[socket.id] = [];

    console.log(`Navios de ${socket.id} registrados em ${roomId}`);

    // Quando ambos tiverem enviado seus navios, inicializa hitsAgainst para ambos e notifica
    if (Object.keys(r.ships).length === 2) {
      for (const pid of r.players) {
        if (!Array.isArray(r.hitsAgainst[pid])) r.hitsAgainst[pid] = [];
      }
      io.to(roomId).emit("readyToPlay");
      io.to(roomId).emit("turnUpdate", { turn: r.turn });
      io.to(r.turn).emit("yourTurn"); // compatibilidade
    }
  });

  // RECEBER ATAQUE
  socket.on("attack", ({ x, y }) => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const r = rooms[roomId];

    if (!r || !r.gameStarted) {
      socket.emit("message", "Partida não iniciada.");
      return;
    }

    // lock simples para evitar processar >1 ataque simultâneo
    if (r.lock) {
      socket.emit("message", "Aguarde processamento...");
      return;
    }
    r.lock = true;

    // valida turno
    if (socket.id !== r.turn) {
      socket.emit("message", "⛔ Não é seu turno!");
      r.lock = false;
      return;
    }

    const opponentId = r.players.find((id) => id !== socket.id);
    if (!opponentId || !r.ships[opponentId]) {
      socket.emit("message", "Oponente não pronto ou ausente.");
      r.lock = false;
      return;
    }

    // garante array de ataques contra oponente
    if (!Array.isArray(r.hitsAgainst[opponentId])) r.hitsAgainst[opponentId] = [];

    // previne que este mesmo jogador ataque a mesma célula no tabuleiro do oponente
    const alreadyAttackedByMe = r.hitsAgainst[opponentId].some(h => h.x === x && h.y === y && h.by === socket.id);
    if (alreadyAttackedByMe) {
      socket.emit("message", "Você já atacou esse quadrado no tabuleiro do adversário. Escolha outro.");
      r.lock = false;
      return;
    }

    // verifica acerto
    let hit = false;
    for (const ship of r.ships[opponentId]) {
      const { size, orientation, x: sx, y: sy } = ship;
      for (let i = 0; i < size; i++) {
        const posX = orientation === "horizontal" ? sx + i : sx;
        const posY = orientation === "vertical" ? sy + i : sy;
        if (posX === x && posY === y) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }

    // registra o ataque como contra o opponentId (com informação de quem atacou)
    r.hitsAgainst[opponentId].push({ x, y, result: hit ? "hit" : "miss", by: socket.id });

    // envia resultado para ambos
    io.to(roomId).emit("attackResult", {
      attacker: socket.id,
      x,
      y,
      result: hit ? "hit" : "miss",
    });

    // troca SEMPRE o turno (uma jogada por turno)
    r.turn = opponentId;

    // envia atualização autoritativa do turno para todos
    io.to(roomId).emit("turnUpdate", { turn: r.turn });

    // verifica condição de vitória de forma robusta (contagem de coordenadas únicas)
    const opponentCells = r.ships[opponentId].flatMap((ship) => {
      const cells = [];
      for (let i = 0; i < ship.size; i++) {
        cells.push({
          x: ship.orientation === "horizontal" ? ship.x + i : ship.x,
          y: ship.orientation === "vertical" ? ship.y + i : ship.y,
        });
      }
      return cells;
    });

    // cria um Set de coordenadas "x,y" únicas que foram registradas como hit contra o opponentId
    const hitsSet = new Set();
    for (const h of r.hitsAgainst[opponentId]) {
      if (h.result !== "hit") continue;
      // só conta se essa coordenada realmente pertence ao conjunto de células do oponente
      if (opponentCells.some(c => c.x === h.x && c.y === h.y)) {
        hitsSet.add(`${h.x},${h.y}`);
      }
    }

    if (hitsSet.size >= opponentCells.length) {
      io.to(roomId).emit("gameOver", { winner: socket.id });
      delete rooms[roomId];
      console.log(`Sala ${roomId} encerrada. Vencedor: ${socket.id}`);
    }

    r.lock = false;
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    console.log("Jogador desconectado:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        io.to(roomId).emit("playerLeft", socket.id);
        delete rooms[roomId];
        console.log(`Sala ${roomId} removida.`);
        break;
      }
    }
  });
});

// Auxiliar
function getRoomByPlayer(playerId) {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.includes(playerId)) return roomId;
  }
  return null;
}

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
