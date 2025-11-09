const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = {};

// ===== Função auxiliar =====
function getRoomByPlayer(playerId) {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.includes(playerId)) return roomId;
  }
  return null;
}

function assignToAvailableRoom(socket) {
  let roomJoined = null;
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
      ships: {},
      hitsAgainst: {},
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
  if (room.players.length === 2) {
    room.gameStarted = true;
    room.turn = room.players[0];
    io.to(roomJoined).emit("startGame", { roomId: roomJoined });
    io.to(roomJoined).emit("turnUpdate", { turn: room.turn });
  }
}

// ====== Conexão ======
io.on("connection", (socket) => {
  console.log("Novo jogador conectado:", socket.id);

  assignToAvailableRoom(socket);

  // ===== Receber posições dos navios =====
  socket.on("placeShips", (ships) => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const r = rooms[roomId];

    r.ships[socket.id] = ships;
    if (!Array.isArray(r.hitsAgainst[socket.id])) r.hitsAgainst[socket.id] = [];

    if (Object.keys(r.ships).length === 2) {
      for (const pid of r.players) {
        if (!Array.isArray(r.hitsAgainst[pid])) r.hitsAgainst[pid] = [];
      }
      io.to(roomId).emit("readyToPlay");
      io.to(roomId).emit("turnUpdate", { turn: r.turn });
      io.to(r.turn).emit("yourTurn");
    }
  });

  // ===== Receber ataque =====
  socket.on("attack", ({ x, y }) => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const r = rooms[roomId];

    if (!r || !r.gameStarted) return;

    if (r.lock) return socket.emit("message", "Aguarde processamento...");
    r.lock = true;

    if (socket.id !== r.turn) {
      socket.emit("message", "⛔ Não é seu turno!");
      r.lock = false;
      return;
    }

    const opponentId = r.players.find((id) => id !== socket.id);
    if (!opponentId || !r.ships[opponentId]) {
      socket.emit("message", "Oponente não pronto.");
      r.lock = false;
      return;
    }

    if (!Array.isArray(r.hitsAgainst[opponentId])) r.hitsAgainst[opponentId] = [];

    const already = r.hitsAgainst[opponentId].some(
      (h) => h.x === x && h.y === y && h.by === socket.id
    );
    if (already) {
      socket.emit("message", "Você já atacou esse quadrado.");
      r.lock = false;
      return;
    }

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

    r.hitsAgainst[opponentId].push({ x, y, result: hit ? "hit" : "miss", by: socket.id });

    io.to(roomId).emit("attackResult", { attacker: socket.id, x, y, result: hit ? "hit" : "miss" });

    // Troca o turno (1 jogada por vez)
    r.turn = opponentId;
    io.to(roomId).emit("turnUpdate", { turn: r.turn });

    // ===== Verifica vitória =====
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

    const hitsSet = new Set();
    for (const h of r.hitsAgainst[opponentId]) {
      if (h.result !== "hit") continue;
      if (opponentCells.some((c) => c.x === h.x && c.y === h.y)) {
        hitsSet.add(`${h.x},${h.y}`);
      }
    }

    if (hitsSet.size >= opponentCells.length) {
      io.to(roomId).emit("gameOverOptions", { winner: socket.id });
      console.log(`Sala ${roomId} encerrada. Vencedor: ${socket.id}`);
    }

    r.lock = false;
  });

  // ===== Revanche / Nova partida =====
  socket.on("rematchRequest", () => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const room = rooms[roomId];

    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(socket.id);

    if (room.rematchVotes.size === 2) {
      room.ships = {};
      room.hitsAgainst = {};
      room.turn = room.players[0];
      room.gameStarted = false;
      room.lock = false;
      delete room.rematchVotes;

      io.to(roomId).emit("rematchStart");
      console.log(`Revanche iniciada na sala ${roomId}`);
    } else {
      socket.emit("message", "Aguardando o adversário aceitar a revanche...");
    }
  });

  socket.on("newMatchRequest", () => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const room = rooms[roomId];

    socket.leave(roomId);
    room.players = room.players.filter((id) => id !== socket.id);
    if (room.players.length === 0) delete rooms[roomId];

    assignToAvailableRoom(socket);
  });

  // ===== Desconexão =====
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

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
